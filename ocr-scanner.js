
/* JustAReminder gratis OCR, geen AI-account of betaalde API nodig.
   Tesseract.js herkent lokaal in de browser; modelbestanden worden via CDN geladen.
   Alle resultaten moeten door de gebruiker worden gecontroleerd. */
(function (global) {
  'use strict';
  let loading;

  function loadOCR() {
    if (global.Tesseract) return Promise.resolve(global.Tesseract);

    if (!loading) loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      script.onload = () => global.Tesseract
        ? resolve(global.Tesseract)
        : reject(Error('OCR-bibliotheek ontbreekt.'));
      script.onerror = () => reject(
        Error('OCR kon niet worden geladen. Controleer je internetverbinding.')
      );
      document.head.appendChild(script);
    });

    return loading;
  }

  function validDate(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y &&
           dt.getUTCMonth() === m - 1 &&
           dt.getUTCDate() === d;
  }

  function dateFromLine(line) {
    let m = line.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);

    if (m) {
      const y = +m[1], mo = +m[2], d = +m[3];

      if (validDate(y, mo, d)) {
        return {
          date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
          matched: m[0]
        };
      }
    }

    m = line.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);

    if (m) {
      const d = +m[1], mo = +m[2], y = +m[3];

      if (validDate(y, mo, d)) {
        return {
          date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
          matched: m[0]
        };
      }
    }

    return { date: null, matched: '' };
  }

  function parse(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map(s => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 80);

    return lines
      .filter(line => /[A-Za-zÀ-ÿ]/.test(line) || /\d/.test(line))
      .slice(0, 30)
      .map(line => {
        const { date, matched } = dateFromLine(line);

        const tm = line.match(/\b(?:[01]?\d|2[0-3])[:.]([0-5]\d)\b/);

        const time = tm
          ? tm[0].replace('.', ':').padStart(5, '0')
          : null;

        let title = line;

        if (matched) title = title.replace(matched, ' ');
        if (tm) title = title.replace(tm[0], ' ');

        title = title
          .replace(/^[\s,:;\-–|]+|[\s,:;\-–|]+$/g, '')
          .trim();

        if (!title) title = 'Controleer afspraak';

        return {
          title: title.slice(0, 250),
          entry_type: 'reminder',
          event_date: date,
          event_time: time,
          recurrence: 'none',
          weekday: null,
          priority: 'normal',
          notes: 'OCR-bron: ' + line.slice(0, 850),
          requires_review: true,
          confidence: 'low',
          selected: true
        };
      });
  }

  async function scan(file, onProgress) {
    if (!file || !file.type.startsWith('image/')) {
      throw Error('Kies een foto (JPG, PNG of WebP).');
    }

    if (file.size > 12 * 1024 * 1024) {
      throw Error('Foto is te groot (maximaal 12 MB).');
    }

    const Tesseract = await loadOCR();

    const worker = await Tesseract.createWorker('nld+eng', 1, {
      logger: data => {
        if (data.status === 'recognizing text' && onProgress) {
          onProgress(Math.round((data.progress || 0) * 100));
        }
      }
    });

    try {
      const { data } = await worker.recognize(file);

      return {
        text: data.text || '',
        entries: parse(data.text || '')
      };

    } finally {
      await worker.terminate();
    }
  }

  global.JustAReminderOCR = { scan, parse };

})(window);
