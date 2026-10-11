-- JustAReminder Privé — definitieve abonnementsstructuur 2026-10-11
-- Veilig gefaseerd: GEEN automatische incasso en GEEN directe beperking van bestaande klanten.
-- Geschikt naast de bestaande Family-SQL. Maak vooraf een database-back-up.
-- Voer dit uit in het Supabase-project waarmee dashboard.html verbonden is.
-- Controleer na installatie met JustAReminder-Prive-CONTROLE.sql.
-- Betaalde rechten mogen UITSLUITEND door de vertrouwde betalingswebhook/service_role worden aangepast.
BEGIN;

-- De Family-installatie gebruikt dezelfde gebruiker-entitlements. Laat deze tabel bestaan.
CREATE TABLE IF NOT EXISTS public.jar_user_plan_entitlements (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_code text NOT NULL DEFAULT 'free' CHECK (plan_code IN ('free','plus','premium')),
  status text NOT NULL DEFAULT 'inactive' CHECK (status IN ('inactive','active','trialing','canceled')),
  valid_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.jar_user_plan_entitlements
  ADD COLUMN IF NOT EXISTS bundle_count integer NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname='jar_private_bundle_count_nonnegative'
      AND conrelid='public.jar_user_plan_entitlements'::regclass
  ) THEN
    ALTER TABLE public.jar_user_plan_entitlements
      ADD CONSTRAINT jar_private_bundle_count_nonnegative
      CHECK (bundle_count BETWEEN 0 AND 10000);
  END IF;
END $$;

-- Opt-in veiligheidsvlag: automatisch UIT. Alleen beheerder kan deze later omschakelen.
CREATE TABLE IF NOT EXISTS public.jar_private_billing_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id=true),
  enforcement_enabled boolean NOT NULL DEFAULT false,
  payments_enabled boolean NOT NULL DEFAULT false
);
INSERT INTO public.jar_private_billing_settings(id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.jar_private_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('plus','premium','free','add_bundle','remove_bundle')),
  expected_bundle_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','completed','canceled','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS jar_private_one_pending_change
  ON public.jar_private_change_requests (user_id) WHERE status='pending';

ALTER TABLE public.jar_user_plan_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jar_private_billing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jar_private_change_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jar_user_plan_entitlements,public.jar_private_billing_settings,
  public.jar_private_change_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.jar_user_plan_entitlements,public.jar_private_billing_settings,
  public.jar_private_change_requests TO service_role;

CREATE OR REPLACE FUNCTION public.jar_private_billing_live()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT coalesce((SELECT enforcement_enabled AND payments_enabled
                   FROM public.jar_private_billing_settings WHERE id=true), false);
$$;

-- Alleen persoonlijke herinneringen (family_id IS NULL). Family-items worden apart geteld.
CREATE OR REPLACE FUNCTION public.jar_private_active_count(p_user uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT count(*)::integer FROM public.reminders r
    WHERE r.user_id=p_user AND r.family_id IS NULL AND r.afgerond IS DISTINCT FROM true;
$$;

-- Legacy-ondersteuning zolang Mollie niet klaar is: bestaande profielen behouden hun
-- vorige capaciteit. Bij live-abonnementen zijn uitsluitend geverifieerde rechten geldig.
CREATE OR REPLACE FUNCTION public.jar_private_entitlement(p_user uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_live boolean; v_plan text; v_status text; v_bundles integer;
        v_legacy jsonb; v_legacy_code text; v_valid boolean;
BEGIN
  v_live:=public.jar_private_billing_live();
  SELECT e.plan_code,e.status,e.bundle_count,
         (e.status IN ('active','trialing') AND (e.valid_until IS NULL OR e.valid_until>now()))
    INTO v_plan,v_status,v_bundles,v_valid
    FROM public.jar_user_plan_entitlements e WHERE e.user_id=p_user;
  v_plan:=coalesce(v_plan,'free');
  v_bundles:=coalesce(v_bundles,0);
  IF v_live THEN
    IF NOT coalesce(v_valid,false) THEN v_plan:='free';v_bundles:=0; END IF;
    IF v_plan<>'premium' THEN v_bundles:=0; END IF;
  ELSE
    SELECT to_jsonb(p) INTO v_legacy FROM public.profiles p WHERE p.id=p_user;
    v_legacy_code:=coalesce(v_legacy->>'plan_code',v_legacy->>'plan','free');
    -- Geverifieerde betaalrechten gaan voor op een oud/gratis profielveld.
    IF coalesce(v_valid,false) AND v_plan IN ('plus','premium') THEN
      IF v_plan<>'premium' THEN v_bundles:=0; END IF;
    ELSIF v_legacy_code IN ('free','basic25','pro50') THEN
      v_plan:=CASE v_legacy_code WHEN 'basic25' THEN 'plus' WHEN 'pro50' THEN 'premium' ELSE 'free' END;
      v_bundles:=CASE WHEN v_plan='premium' AND coalesce(v_legacy->>'addon50_active','false')='true' THEN 1 ELSE 0 END;
    ELSIF v_plan<>'premium' THEN
      v_bundles:=0;
    END IF;
  END IF;
  RETURN jsonb_build_object('plan',v_plan,'bundle_count',v_bundles,'billing_live',v_live,
    'limit',CASE v_plan WHEN 'plus' THEN 25 WHEN 'premium' THEN 50+50*v_bundles ELSE 3 END,
    'verified_paid',coalesce(v_valid,false));
END;
$$;

CREATE OR REPLACE FUNCTION public.jar_private_capacity(p_user uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
  SELECT (public.jar_private_entitlement(p_user)->>'limit')::integer;
$$;

-- Geen p_user_id-parameter: ingelogde gebruiker kan geen andere abonnementen lezen.
CREATE OR REPLACE FUNCTION public.jar_get_private_subscription()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_user uuid; v_ent jsonb; v_count integer; v_limit integer;
        v_bundles integer; v_pending text; v_plan text;
BEGIN
  v_user:=auth.uid();
  IF v_user IS NULL THEN RAISE EXCEPTION 'Log opnieuw in.'; END IF;
  v_ent:=public.jar_private_entitlement(v_user);
  v_count:=public.jar_private_active_count(v_user);
  v_limit:=(v_ent->>'limit')::integer;
  v_bundles:=(v_ent->>'bundle_count')::integer;
  v_plan:=v_ent->>'plan';
  SELECT action INTO v_pending FROM public.jar_private_change_requests
    WHERE user_id=v_user AND status='pending' LIMIT 1;
  RETURN jsonb_build_object('plan_code',v_plan,'bundle_count',v_bundles,
    'active_count',v_count,'task_limit',v_limit,'billing_live',(v_ent->>'billing_live')::boolean,
    'verified_paid',(v_ent->>'verified_paid')::boolean,
    'price_month',CASE v_plan WHEN 'plus' THEN 4.99 WHEN 'premium' THEN 9.99+3*v_bundles ELSE 0 END,
    'pending_action',v_pending,
    'can_add_bundle',v_plan='premium' AND (v_ent->>'billing_live')::boolean,
    'can_remove_bundle',v_plan='premium' AND v_bundles>0 AND v_count<=v_limit-50,
    'minimum_to_complete',CASE WHEN v_bundles>0 THEN greatest(0,v_count-(v_limit-50)) ELSE 0 END,
    'family_eligible',v_plan='premium' AND (v_ent->>'verified_paid')::boolean);
END;
$$;

-- Alleen vóór INSERT of bij nieuw actief maken/overzetten controleren. Normale
-- bewerkingen van al actieve items mogen ook boven de limiet blijven werken.
CREATE OR REPLACE FUNCTION public.jar_guard_private_reminder_quota()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_used integer; v_limit integer; v_check boolean;
BEGIN
  IF NEW.family_id IS NOT NULL OR NEW.afgerond IS TRUE
    OR NOT public.jar_private_billing_live() THEN RETURN NEW; END IF;
  v_check:=(TG_OP='INSERT');
  IF TG_OP='UPDATE' THEN
    v_check:=OLD.afgerond IS TRUE OR OLD.family_id IS NOT NULL
             OR OLD.user_id IS DISTINCT FROM NEW.user_id;
  END IF;
  IF NOT v_check THEN RETURN NEW; END IF;
  -- Vergrendel per eigenaar om twee parallelle inserts boven quota te voorkomen.
  PERFORM pg_advisory_xact_lock(hashtext('jar_private_quota'),hashtext(NEW.user_id::text));
  v_limit:=public.jar_private_capacity(NEW.user_id);
  SELECT count(*)::integer INTO v_used FROM public.reminders r
    WHERE r.user_id=NEW.user_id AND r.family_id IS NULL AND r.afgerond IS DISTINCT FROM true
      AND (TG_OP='INSERT' OR r.id<>NEW.id);
  IF v_used>=v_limit THEN
    RAISE EXCEPTION 'Je Privé-limiet is bereikt (%/%). Rond eerst een herinnering af of breid uit.',v_used,v_limit
      USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS jar_private_quota_guard ON public.reminders;
CREATE TRIGGER jar_private_quota_guard BEFORE INSERT OR UPDATE OF family_id,user_id,afgerond
  ON public.reminders FOR EACH ROW EXECUTE FUNCTION public.jar_guard_private_reminder_quota();

-- Leg verzoek vast; rechten wijzigen pas na betrouwbare betalingsbevestiging.
CREATE OR REPLACE FUNCTION public.jar_private_request_subscription_change(p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_user uuid; v_e jsonb; v_count integer; v_limit integer; v_bundles integer; v_id uuid;
BEGIN
  v_user:=auth.uid();
  IF v_user IS NULL THEN RAISE EXCEPTION 'Log opnieuw in.'; END IF;
  IF NOT public.jar_private_billing_live() THEN
    RAISE EXCEPTION 'Betalingen en abonnementswijzigingen zijn nog niet geactiveerd.';
  END IF;
  IF p_action NOT IN ('plus','premium','free','add_bundle','remove_bundle') THEN
    RAISE EXCEPTION 'Onbekende abonnementswijziging.';
  END IF;
  PERFORM 1 FROM auth.users WHERE id=v_user FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.jar_private_change_requests
             WHERE user_id=v_user AND status='pending') THEN
    RAISE EXCEPTION 'Er staat al een abonnementswijziging open.';
  END IF;
  v_e:=public.jar_private_entitlement(v_user);
  v_count:=public.jar_private_active_count(v_user);
  v_limit:=(v_e->>'limit')::integer;
  v_bundles:=(v_e->>'bundle_count')::integer;
  IF p_action='add_bundle' AND v_e->>'plan'<>'premium' THEN
    RAISE EXCEPTION 'Extra bundels zijn alleen beschikbaar bij Privé Premium.';
  END IF;
  IF p_action='remove_bundle' THEN
    IF v_e->>'plan'<>'premium' OR v_bundles<=0 THEN
      RAISE EXCEPTION 'Je hebt geen extra bundel om te verwijderen.';
    END IF;
    IF v_count>v_limit-50 THEN
      RAISE EXCEPTION 'Je gebruikt % herinneringen. Verlagen naar % kan pas als je er minstens % afrondt of verwijdert.',
        v_count,v_limit-50,v_count-(v_limit-50);
    END IF;
  END IF;
  IF p_action='plus' AND v_count>25 THEN
    RAISE EXCEPTION 'Je gebruikt % actieve herinneringen. Verlagen naar 25 kan nog niet.',v_count;
  END IF;
  IF p_action='free' AND v_count>3 THEN
    RAISE EXCEPTION 'Je gebruikt % actieve herinneringen. Verlagen naar 3 kan nog niet.',v_count;
  END IF;
  IF p_action IN ('plus','premium') AND v_e->>'plan'=p_action THEN
    RAISE EXCEPTION 'Dit pakket is al actief.';
  END IF;
  INSERT INTO public.jar_private_change_requests(user_id,action,expected_bundle_count)
    VALUES(v_user,p_action,v_bundles) RETURNING id INTO v_id;
  RETURN jsonb_build_object('request_id',v_id,'status','pending',
      'message','Verzoek ontvangen. De limiet verandert pas na betalings- of opzegbevestiging.');
END;
$$;

-- Minimale rechten voor alleen de RPC's; nooit rechtstreeks tabellen bewerken.
REVOKE ALL ON FUNCTION public.jar_private_entitlement(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.jar_private_capacity(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.jar_private_active_count(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.jar_private_billing_live() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.jar_guard_private_reminder_quota() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.jar_get_private_subscription() FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.jar_private_request_subscription_change(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.jar_get_private_subscription() TO authenticated;
GRANT EXECUTE ON FUNCTION public.jar_private_request_subscription_change(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.jar_guard_private_reminder_quota() TO service_role;
GRANT EXECUTE ON FUNCTION public.jar_private_capacity(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.jar_private_entitlement(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.jar_private_active_count(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.jar_private_billing_live() TO service_role;
COMMIT;
