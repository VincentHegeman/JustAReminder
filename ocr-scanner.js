
/*
 * JustAReminder — Gratis OCR Scanner V2
 * Herkent tekst uit agenda's en voegt bijbehorende
 * regels samen tot één herinnering.
 *
 * Geen OpenAI- of Gemini-key nodig.
 * Alle resultaten blijven controleerbaar.
 */

(function (global) {
  'use strict';

  let loading = null;

  const maanden = {
    januari: 1, jan: 1,
    februari: 2, feb: 2,
    maart: 3, mrt: 3,
    april: 4, apr: 4,
    mei: 5,
    juni: 6, jun: 6,
    juli: 7, jul: 7,
    augustus: 8, aug: 8,
    september: 9, sep: 9, sept: 9,
    oktober: 10, okt: 10,
    november: 11, nov: 11,
    december: 12, dec: 12
  };

  function laadOCR() {
    if (global.Tesseract) {
      return Promise.resolve(global.Tesseract);
    }

    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const script = document.createElement('script');

        script.src =
          'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

        script.onload = () => {
          if (global.Tesseract) {
            resolve(global.Tesseract);
          } else {
            reject(new Error('OCR-bibliotheek ontbreekt.'));
          }
        };

        script.onerror = () => {
          reject(new Error(
            'OCR kon niet worden geladen. Controleer je internet.'
          ));
        };

        document.head.appendChild(script);
      }).catch(error => {
        loading = null;
        throw error;
      });
    }

    return loading;
  }

  function geldigeDatum(jaar, maand, dag) {
    const d = new Date(Date.UTC(jaar, maand - 1, dag));

    return (
      d.getUTCFullYear() === jaar &&
      d.getUTCMonth() === maand - 1 &&
      d.getUTCDate() === dag
    );
  }

  function datumTekst(jaar, maand, dag) {
    return (
      jaar + '-' +
      String(maand).padStart(2, '0') + '-' +
      String(dag).padStart(2, '0')
    );
  }

  function kiesJaar(maand, dag) {
    const vandaag = new Date();
    const huidigJaar = vandaag.getFullYear();

    // Kies dit jaar, of volgend jaar als de datum
    // al voorbij is. Laat de gebruiker dit controleren.
    for (const jaar of [huidigJaar, huidigJaar + 1]) {
      if (!geldigeDatum(jaar, maand, dag)) continue;

      const kandidaat = new Date(
        jaar, maand - 1, dag, 23, 59, 59
      );

      if (kandidaat >= vandaag) {
        return jaar;
      }
    }

    return huidigJaar;
  }

  function herkenDatum(tekst) {
    let match;

    // Voorbeeld: 2026-10-13
    match = tekst.match(
      /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/
    );

    if (match) {
      const jaar = Number(match[1]);
      const maand = Number(match[2]);
      const dag = Number(match[3]);

      if (geldigeDatum(jaar, maand, dag)) {
        return {
          date: datumTekst(jaar, maand, dag),
          matched: match[0],
          assumedYear: false
        };
      }
    }

    // Voorbeeld: 13-10-2026 of 13/10
    match = tekst.match(
      /\b(\d{1,2})[-/.](\d{1,2})(?:[-/.](20\d{2}))?\b/
    );

    if (match) {
      const dag = Number(match[1]);
      const maand = Number(match[2]);
      const aangenomen = !match[3];

      const jaar = match[3]
        ? Number(match[3])
        : kiesJaar(maand, dag);

      if (geldigeDatum(jaar, maand, dag)) {
        return {
          date: datumTekst(jaar, maand, dag),
          matched: match[0],
          assumedYear: aangenomen
        };
      }
    }

    // Voorbeeld: 13 oktober of 13 oktober 2026
    const maandnamen = Object.keys(maanden)
      .sort((a, b) => b.length - a.length)
      .join('|');

    const regex = new RegExp(
      '\\b(\\d{1,2})\\s+(' +
      maandnamen +
      ')(?:\\s+(20\\d{2}))?\\b',
      'i'
    );

    match = tekst.match(regex);

    if (match) {
      const dag = Number(match[1]);
      const maand = maanden[match[2].toLowerCase()];
      const aangenomen = !match[3];

      const jaar = match[3]
        ? Number(match[3])
        : kiesJaar(maand, dag);

      if (geldigeDatum(jaar, maand, dag)) {
        return {
          date: datumTekst(jaar, maand, dag),
          matched: match[0],
          assumedYear: aangenomen
        };
      }
    }

    return {
      date: null,
      matched: '',
      assumedYear: false
    };
  }

  function herkenTijd(tekst) {
    const match = tekst.match(
      /\b(?:om\s+)?([01]?\d|2[0-3])[:.]([0-5]\d)\b/i
    );

    if (!match) return null;

    return (
      String(Number(match[1])).padStart(2, '0') +
      ':' + match[2]
    );
  }

  function herkenLocatie(tekst) {
    // Herkent o.a. "in Zwolle" en "te Amsterdam".
    const match = tekst.match(
      /\b(?:in|te|locatie:)\s+([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+)*)/
    );

    return match ? match[1] : null;
  }

  function maakTitel(tekst, locatie) {
    if (/\bkvk\b/i.test(tekst)) {
      return locatie
        ? 'KVK-inschrijving ' + locatie
        : 'KVK-afspraak';
    }

    if (/\b(tandarts|dokter|huisarts|ziekenhuis)\b/i.test(tekst)) {
      const match = tekst.match(
        /\b(tandarts|dokter|huisarts|ziekenhuis)\b/i
      );
      return 'Afspraak ' + match[1].toLowerCase();
    }

    if (/\bmedicijn|medicatie\b/i.test(tekst)) {
      return 'Medicatieherinnering';
    }

    let titel = tekst
      .replace(/\b\d{1,2}\s+[a-z]+\s*(?:20\d{2})?\b/gi, '')
      .replace(/\b\d{1,2}[:.]\d{2}\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    titel = titel.split(/[.!?\n]/)[0].trim();

    return titel.slice(0, 100) || 'Controleer herinnering';
  }

  function maakHerinnering(regels) {
    const tekst = regels.join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!tekst) return null;

    const datum = herkenDatum(tekst);
    const tijd = herkenTijd(tekst);
    const locatie = herkenLocatie(tekst);

    const belangrijk =
      /niet vergeten|belangrijk|dringend|urgent|moet mee|meenemen|!/i
        .test(tekst);

    const titel = maakTitel(tekst, locatie);

    let notities = tekst;

    if (locatie && !new RegExp(
      'Locatie:\\s*' + locatie, 'i'
    ).test(notities)) {
      notities += '\nLocatie: ' + locatie;
    }

    if (datum.assumedYear) {
      notities += '\nLet op: jaartal is automatisch aangenomen.';
    }

    return {
      title: titel,
      entry_type: 'reminder',
      event_date: datum.date,
      event_time: tijd,
      recurrence: 'none',
      weekday: null,
      priority: belangrijk ? 'high' : 'normal',
      notes: notities.slice(0, 1000),
      requires_review: true,
      confidence: 'low',
      selected: true
    };
  }

  function parse(tekst) {
    const regels = String(tekst || '')
      .split(/\r?\n/)
      .map(regel => regel.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 100);

    if (!regels.length) return [];

    const groepen = [];
    let huidigeGroep = [];
    let huidigeDatum = null;

    for (const regel of regels) {
      const gevonden = herkenDatum(regel);

      // Alleen bij een duidelijk andere datum beginnen
      // we aan een nieuwe afspraak.
      if (
        gevonden.date &&
        huidigeDatum &&
        gevonden.date !== huidigeDatum &&
        huidigeGroep.length
      ) {
        groepen.push(huidigeGroep);
        huidigeGroep = [];
      }

      huidigeGroep.push(regel);

      if (gevonden.date) {
        huidigeDatum = gevonden.date;
      }
    }

    if (huidigeGroep.length) {
      groepen.push(huidigeGroep);
    }

    const resultaten = groepen
      .map(maakHerinnering)
      .filter(Boolean);

    return resultaten.slice(0, 30);
  }

  async function scan(file, onProgress) {
    if (!file || !file.type.startsWith('image/')) {
      throw new Error('Kies een JPG-, PNG- of WebP-foto.');
    }

    if (file.size > 12 * 1024 * 1024) {
      throw new Error('Foto is te groot. Maximaal 12 MB.');
    }

    const Tesseract = await laadOCR();

    const worker = await Tesseract.createWorker(
      'nld+eng',
      1,
      {
        logger: data => {
          if (
            data.status === 'recognizing text' &&
            typeof onProgress === 'function'
          ) {
            onProgress(
              Math.round((data.progress || 0) * 100)
            );
          }
        }
      }
    );

    try {
      const { data } = await worker.recognize(file);

      const tekst = data.text || '';

      return {
        text: tekst,
        entries: parse(tekst)
      };
    } finally {
      await worker.terminate();
    }
  }

  global.JustAReminderOCR = {
    scan,
    parse
  };

})(window);
