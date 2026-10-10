
/*
 * JustAReminder - OCR Scanner V4
 *
 * Gratis OCR met Tesseract.js.
 * Werkt in de browser, zonder betaalde API.
 *
 * BELANGRIJK:
 * Tesseract is beperkt bij handschrift.
 * De scanner verzint geen afspraken.
 * Alles moet worden gecontroleerd voor opslag.
 *
 * Beschikbare functies:
 *
 * JustAReminderOCR.scan(file, onProgress)
 * JustAReminderOCR.parse(text)
 *
 * scan() geeft terug:
 *
 * {
 *   text: string,
 *   entries: array,
 *   confidence: number,
 *   warning: string | null
 * }
 */

(function (window) {
  "use strict";

  const VERSION = "4.0.0";

  const TESSERACT_URL =
    "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

  const MAX_FILE_SIZE = 12 * 1024 * 1024;

  let tesseractLoading = null;

  const MONTHS = {
    januari: 1,
    jan: 1,
    februari: 2,
    feb: 2,
    maart: 3,
    mrt: 3,
    april: 4,
    apr: 4,
    mei: 5,
    juni: 6,
    jun: 6,
    juli: 7,
    jul: 7,
    augustus: 8,
    aug: 8,
    september: 9,
    sep: 9,
    sept: 9,
    oktober: 10,
    okt: 10,
    november: 11,
    nov: 11,
    december: 12,
    dec: 12
  };

  const MONTH_PATTERN =
    Object.keys(MONTHS)
      .sort((a, b) => b.length - a.length)
      .join("|");

  const SIGNAL_WORDS =
    /\b(afspraak|agenda|mama|papa|eten|lunch|diner|ontbijt|kvk|inschrijving|dokter|tandarts|huisarts|ziekenhuis|kapper|vergadering|gesprek|controle|school|werk|medicatie|medicijnen|meenemen|ophalen|bellen|betalen|vergeten|herinnering|verjaardag|bezoek)\b/i;

  const IMPORTANT_WORDS =
    /\b(niet vergeten|dringend|spoed|urgent|belangrijk|meenemen|moet mee|uiterlijk)\b/i;

  const LOCATION_WORDS =
    /\b(?:in|te|locatie:)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]{2,}(?:\s+[A-Z][a-zà-ÿ'-]+)*)/i;

  function loadTesseract() {
    if (window.Tesseract) {
      return Promise.resolve(window.Tesseract);
    }

    if (tesseractLoading) {
      return tesseractLoading;
    }

    tesseractLoading = new Promise((resolve, reject) => {
      const script = document.createElement("script");

      script.src = TESSERACT_URL;
      script.async = true;

      script.onload = () => {
        if (window.Tesseract) {
          resolve(window.Tesseract);
        } else {
          reject(
            new Error("De OCR-bibliotheek kon niet starten.")
          );
        }
      };

      script.onerror = () => {
        reject(
          new Error(
            "Tesseract kon niet worden geladen. Controleer je internetverbinding."
          )
        );
      };

      document.head.appendChild(script);
    }).catch(error => {
      tesseractLoading = null;
      throw error;
    });

    return tesseractLoading;
  }

  function cleanLine(value) {
    return String(value || "")
      .normalize("NFC")
      .replace(/\r/g, "")
      .replace(/[ \t]+/g, " ")
      .replace(/^[|=_~*•]+/, "")
      .replace(/[|=_~*•]+$/, "")
      .trim();
  }

  function validDate(year, month, day) {
    const date = new Date(
      Date.UTC(year, month - 1, day)
    );

    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }

  function formatDate(year, month, day) {
    return [
      String(year).padStart(4, "0"),
      String(month).padStart(2, "0"),
      String(day).padStart(2, "0")
    ].join("-");
  }

  function guessYear(month, day) {
    const today = new Date();

    let year = today.getFullYear();

    const proposed = new Date(year, month - 1, day);

    const startOfToday = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );

    if (proposed < startOfToday) {
      year += 1;
    }

    return year;
  }

  function getDate(text) {
    let match = text.match(
      /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/
    );

    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);

      if (validDate(year, month, day)) {
        return {
          value: formatDate(year, month, day),
          matched: match[0],
          assumed: false
        };
      }
    }

    match = text.match(
      /\b(\d{1,2})[-/.](\d{1,2})(?:[-/.](20\d{2}))?\b/
    );

    if (match) {
      const day = Number(match[1]);
      const month = Number(match[2]);
      const assumed = !match[3];

      const year = assumed
        ? guessYear(month, day)
        : Number(match[3]);

      if (validDate(year, month, day)) {
        return {
          value: formatDate(year, month, day),
          matched: match[0],
          assumed
        };
      }
    }

    const pattern = new RegExp(
      "\\b(\\d{1,2})\\s+(" +
      MONTH_PATTERN +
      ")(?:\\s+(20\\d{2}))?\\b",
      "i"
    );

    match = text.match(pattern);

    if (match) {
      const day = Number(match[1]);
      const month = MONTHS[match[2].toLowerCase()];

      const assumed = !match[3];

      const year = assumed
        ? guessYear(month, day)
        : Number(match[3]);

      if (validDate(year, month, day)) {
        return {
          value: formatDate(year, month, day),
          matched: match[0],
          assumed
        };
      }
    }

    return {
      value: null,
      matched: "",
      assumed: false
    };
  }

  function getTime(text) {
    const match = text.match(
      /\b(?:om\s+)?([01]?\d|2[0-3])[:.]([0-5]\d)\b/i
    );

    if (!match) {
      return null;
    }

    return (
      String(Number(match[1])).padStart(2, "0") +
      ":" +
      match[2]
    );
  }

  function getLocation(text) {
    const match = text.match(LOCATION_WORDS);

    if (!match) {
      return null;
    }

    let location = match[1].trim();

    location = location.replace(/[.,;!?]+$/, "");

    if (
      location.length < 3 ||
      location.length > 50 ||
      /^\d+$/.test(location)
    ) {
      return null;
    }

    return location.charAt(0).toUpperCase() +
      location.slice(1);
  }

  function looksLikeRealText(text) {
    const cleaned = cleanLine(text);

    if (cleaned.length < 6) {
      return false;
    }

    const characters = cleaned.replace(/\s/g, "");

    const letters =
      cleaned.match(/[A-Za-zÀ-ÿ]/g) || [];

    if (!characters.length) {
      return false;
    }

    const letterRatio =
      letters.length / characters.length;

    if (letterRatio < 0.48) {
      return false;
    }

    const strangeSymbols =
      cleaned.match(/[=<>£€#@~|\\[\]{}]/g) || [];

    if (strangeSymbols.length > 2) {
      return false;
    }

    const words =
      cleaned.match(/[A-Za-zÀ-ÿ]{2,}/g) || [];

    if (words.length < 2) {
      return false;
    }

    return (
      SIGNAL_WORDS.test(cleaned) ||
      Boolean(getDate(cleaned).value)
    );
  }

  function normalizeOCRText(text) {
    return String(text || "")
      .replace(/\r/g, "")
      .split("\n")
      .map(cleanLine)
      .filter(Boolean);
  }

  function parse(text) {
    const lines = normalizeOCRText(text)
      .slice(0, 100);

    if (!lines.length) {
      return [];
    }

    const readableLines = lines.filter(
      looksLikeRealText
    );

    if (!readableLines.length) {
      return [];
    }

    const combined = readableLines.join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const date = getDate(combined);
    const time = getTime(combined);

    const meaningful =
      Boolean(date.value) ||
      SIGNAL_WORDS.test(combined);

    if (!meaningful) {
      return [];
    }

    const location = getLocation(combined);

    let title = combined;

    if (/\bkvk\b/i.test(combined)) {
      title = location
        ? "KVK-afspraak " + location
        : "KVK-afspraak";
    } else if (
      /\b(?:mama|papa)\b/i.test(combined) &&
      /\beten\b/i.test(combined)
    ) {
      title = "Bij " +
        (/\bmama\b/i.test(combined) ? "mama" : "papa") +
        " eten";
    } else {
      if (date.matched) {
        title = title.replace(date.matched, " ");
      }

      title = title
        .replace(/\b(?:om\s+)?\d{1,2}[:.]\d{2}\b/gi, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100);
    }

    const highPriority =
      IMPORTANT_WORDS.test(combined) ||
      combined.includes("!");

    const notes = [combined];

    if (location) {
      notes.push("Locatie: " + location);
    }

    if (date.assumed) {
      notes.push(
        "Controleer het jaartal: dit is automatisch gekozen."
      );
    }

    return [{
      title: title || "Afspraak controleren",
      entry_type: "appointment",
      event_date: date.value,
      event_time: time,
      recurrence: "none",
      weekday: null,
      priority: highPriority ? "high" : "normal",
      notes: notes.join("\n").slice(0, 1000),
      requires_review: true,
      confidence: "low",
      selected: false
    }];
  }

  async function prepareImage(file) {
    const bitmap = await createImageBitmap(file);

    try {
      const maxWidth = 2000;

      const scale = Math.min(
        2,
        maxWidth / bitmap.width
      );

      const width = Math.max(
        1,
        Math.round(bitmap.width * scale)
      );

      const height = Math.max(
        1,
        Math.round(bitmap.height * scale)
      );

      const canvas = document.createElement("canvas");

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext(
        "2d",
        { willReadFrequently: true }
      );

      if (!ctx) {
        throw new Error(
          "Kan afbeelding niet voorbereiden."
        );
      }

      ctx.drawImage(
        bitmap,
        0,
        0,
        width,
        height
      );

      const imageData = ctx.getImageData(
        0,
        0,
        width,
        height
      );

      const data = imageData.data;

      // Grijswaarden en contrastverhoging.
      for (let i = 0; i < data.length; i += 4) {
        const gray =
          0.299 * data[i] +
          0.587 * data[i + 1] +
          0.114 * data[i + 2];

        const contrasted = Math.max(
          0,
          Math.min(255, (gray - 128) * 1.45 + 148)
        );

        data[i] = contrasted;
        data[i + 1] = contrasted;
        data[i + 2] = contrasted;
      }

      ctx.putImageData(imageData, 0, 0);

      return canvas;

    } finally {
      bitmap.close();
    }
  }

  async function scan(file, onProgress) {
    if (!file) {
      throw new Error("Selecteer eerst een foto.");
    }

    const allowed = [
      "image/jpeg",
      "image/png",
      "image/webp"
    ];

    if (!allowed.includes(file.type)) {
      throw new Error(
        "Gebruik een JPG-, PNG- of WebP-foto."
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      throw new Error(
        "De foto mag maximaal 12 MB zijn."
      );
    }

    const Tesseract = await loadTesseract();

    let worker = null;

    try {
      const preparedImage = await prepareImage(file);

      worker = await Tesseract.createWorker(
        "nld+eng",
        1,
        {
          logger: message => {
            if (
              message.status === "recognizing text" &&
              typeof onProgress === "function"
            ) {
              onProgress(
                Math.round(
                  (message.progress || 0) * 100
                )
              );
            }
          }
        }
      );

      // Probeer eerst de verbeterde foto.
      let response = await worker.recognize(
        preparedImage
      );

      let text = response.data?.text || "";

      let confidence =
        Number(response.data?.confidence || 0);

      let entries = parse(text);

      // Bij slechte herkenning een tweede poging
      // met de originele afbeelding.
      if (
        confidence < 55 ||
        entries.length === 0
      ) {
        const fallback = await worker.recognize(file);

        const fallbackText =
          fallback.data?.text || "";

        const fallbackConfidence =
          Number(fallback.data?.confidence || 0);

        const fallbackEntries =
          parse(fallbackText);

        if (
          fallbackEntries.length > entries.length ||
          (
            fallbackEntries.length === entries.length &&
            fallbackConfidence > confidence
          )
        ) {
          text = fallbackText;
          confidence = fallbackConfidence;
          entries = fallbackEntries;
        }
      }

      // Resultaten met te lage zekerheid
      // worden niet automatisch voorgesteld.
      if (
        confidence < 35 ||
        entries.length === 0
      ) {
        return {
          text,
          entries: [],
          confidence,
          warning:
            "De tekst is niet betrouwbaar herkend. " +
            "Gebruik de handschriftmodus om de afspraak " +
            "zelf te controleren en in te vullen."
        };
      }

      return {
        text,
        entries,
        confidence,
        warning:
          "Controleer alle gegevens voordat je opslaat."
      };

    } catch (error) {
      throw new Error(
        "De foto kon niet worden gescand: " +
        (error?.message || "Onbekende fout")
      );

    } finally {
      if (worker) {
        await worker.terminate();
      }
    }
  }

  window.JustAReminderOCR = {
    version: VERSION,
    scan,
    parse
  };

})(window);
