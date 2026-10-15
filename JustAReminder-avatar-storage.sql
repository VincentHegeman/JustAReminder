-- JustAReminder Privé: beveiligde profielfoto opslag (optioneel maar nodig voor echte foto-upload)
-- Voer dit één keer uit in de Supabase SQL editor met beheerrechten.
-- Maak eerst een back-up en controleer eventuele bestaande bucket/policies.
-- Geen openbare URLs: afbeeldingen worden via signed URLs in het eigen account getoond.

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('jar-avatars','jar-avatars',false,3145728,array['image/jpeg'])
on conflict (id) do nothing;

-- Elke gebruiker mag alleen bestanden in zijn eigen map (user-id/...) beheren.
create policy "jar_avatars_read_own" on storage.objects for select to authenticated
using (bucket_id='jar-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

create policy "jar_avatars_insert_own" on storage.objects for insert to authenticated
with check (bucket_id='jar-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

create policy "jar_avatars_update_own" on storage.objects for update to authenticated
using (bucket_id='jar-avatars' and (storage.foldername(name))[1]=auth.uid()::text)
with check (bucket_id='jar-avatars' and (storage.foldername(name))[1]=auth.uid()::text);

create policy "jar_avatars_delete_own" on storage.objects for delete to authenticated
using (bucket_id='jar-avatars' and (storage.foldername(name))[1]=auth.uid()::text);
