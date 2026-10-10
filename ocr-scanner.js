
/*
  JustAReminder - OCR Scanner V3
  --------------------------------
  Gratis agendascanner met Tesseract.js.

  - Geen Gemini of OpenAI nodig
  - Geen API-key nodig
  - Nederlandse en Engelse tekstherkenning
  - Probeert regels van één notitie samen te voegen
  - Herkent Nederlandse datums en tijdstippen
  - Filtert onleesbare OCR-tekst
  - Maximaal 10 voorstellen
  - Alles moet eerst gecontroleerd worden

  Gebruik:
    JustAReminderOCR.scan(file, onProgress)
    JustAReminderOCR.parse(text)

  Retourneert:
    {
      text: "...",
      entries: [...]
    }
*/

(function (window) {
  "use strict";

  const OCR_VERSION = "3.0.0";

  const OCR_URL =
    "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

  let loadingPromise = null;

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

  const KNOWN_WORDS = new Set([
    "afspraak",
    "agenda",
    "apotheek",
    "arts",
    "auto",
    "bezoek",
    "bellen",
    "belangrijk",
    "brief",
    "controle",
    "dag",
    "dierenarts",
    "dokter",
    "formulier",
    "huisarts",
    "inschrijving",
    "kantoor",
    "kapper",
    "kinderen",
    "kvk",
    "map",
    "mee",
    "meenemen",
    "medicatie",
    "medicijnen",
    "middag",
    "morgen",
    "moet",
    "moeten",
    "niet",
    "notitie",
    "oktober",
    "ophalen",
    "school",
    "sleutels",
    "tandarts",
    "taak",
    "testen",
    "tijd",
    "vandaag",
    "vergeten",
    "vergadering",
    "werk",
    "ziekenhuis",
    "zwolle"
  ]);

  const IMPORTANT_WORDS =
    /\b(niet vergeten|belangrijk|dringend|urgent|spoed|meenemen|moet mee|uiterlijk)\b/i;

  const APPOINTMENT_WORDS =
    /\b(afspraak|dokter|huisarts|tandarts|ziekenhuis|kapper|kvk|vergadering|gesprek|controle)\b/i;

  const TASK_WORDS =
    /\b(meenemen|ophalen|kopen|regelen|betalen|bellen|versturen|inleveren)\b/i;

  const MEDICINE_WORDS =
    /\b(medicatie|medicijnen|medicijn|tabletten|pillen)\b/i;

  function loadTesseract() {
    if (window.Tesseract) {
      return Promise.resolve(window.Tesseract);
    }

    if (loadingPromise) {
      return loadingPromise;
    }

    loadingPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");

      script.src = OCR_URL;
      script.async = true;

      script.onload = function () {
        if (window.Tesseract) {
          resolve(window.Tesseract);
        } else {
          reject(
            new Error("OCR-bibliotheek kon niet worden gestart.")
          );
        }
      };

      script.onerror = function () {
        reject(
          new Error(
            "OCR kon niet worden geladen. Controleer je internetverbinding."
          )
        );
      };

      document.head.appendChild(script);
    }).catch(error => {
      loadingPromise = null;
      throw error;
    });

    return loadingPromise;
  }

  function cleanText(value) {
    return String(value || "")
      .normalize("NFC")
      .replace(/[ \t]+/g, " ")
      .replace(/\r/g, "")
      .trim();
  }

  function cleanLine(value) {
    return cleanText(value)
      .replace(/^[|=_~*•]+/, "")
      .replace(/[|=_~*•]+$/, "")
      .trim();
  }

  function validDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }

  function formatDate(year, month, day) {
    return (
      String(year).padStart(4, "0") +
      "-" +
      String(month).padStart(2, "0") +
      "-" +
      String(day).padStart(2, "0")
    );
  }

  function guessYear(month, day) {
    const today = new Date();

    const year = today.getFullYear();

    const todayStart = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate()
    );

    const candidate = new Date(year, month - 1, day);

    return candidate >= todayStart ? year : year + 1;
  }

  function getDate(text) {
    let match;

    // 2026-10-13
    match = text.match(
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

    // 13-10-2026 of 13/10
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

    // 13 oktober 2026 / 13 oktober
    const monthNames = Object.keys(MONTHS)
      .sort((a, b) => b.length - a.length)
      .join("|");

    const pattern = new RegExp(
      "\\b(\\d{1,2})\\s+(" +
        monthNames +
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
    const match = text.match(
      /\b(?:in|te|locatie:)\s+([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+)*)/
    );

    if (!match) {
      return null;
    }

    const location = match[1].trim();

    if (location.length > 50) {
      return null;
    }

    return location;
  }

  function looksReadable(line) {
    const text = cleanLine(line);

    if (text.length < 5) {
      return false;
    }

    const letters = text.match(/[a-zà-ÿ]/gi) || [];

    const characters = text.replace(/\s/g, "");

    if (!characters.length) {
      return false;
    }

    const letterRatio = letters.length / characters.length;

    if (letterRatio < 0.48) {
      return false;
    }

    const words = text.match(/[a-zà-ÿ]{2,}/gi) || [];

    if (words.length < 2) {
      return false;
    }

    // Al te veel losse symbolen? Waarschijnlijk OCR-ruis.
    const strangeSymbols =
      (text.match(/[=<>£€#@~|\\[\]{}]/g) || []).length;

    if (strangeSymbols > 2) {
      return false;
    }

    const knownCount = words.filter(word =>
      KNOWN_WORDS.has(word.toLowerCase())
    ).length;

    const hasDate = Boolean(getDate(text).value);

    const hasImportantContent =
      IMPORTANT_WORDS.test(text) ||
      APPOINTMENT_WORDS.test(text) ||
      TASK_WORDS.test(text) ||
      MEDICINE_WORDS.test(text);

    // Geef voorkeur aan herkenbare agendatekst.
    // Willekeurige woordgroepen worden niet automatisch afspraken.
    return (
      knownCount >= 1 ||
      hasDate ||
      hasImportantContent
    );
  }

  function getEntryType(text) {
    if (APPOINTMENT_WORDS.test(text)) {
      return "appointment";
    }

    if (TASK_WORDS.test(text)) {
      return "task";
    }

    return "reminder";
  }

  function getPriority(text) {
    if (IMPORTANT_WORDS.test(text) || text.includes("!")) {
      return "high";
    }

    return "normal";
  }

  function getTitle(text, location) {
    if (/\bkvk\b/i.test(text)) {
      return location
        ? "KVK-afspraak " + location
        : "KVK-afspraak";
    }

    const medical = text.match(
      /\b(tandarts|huisarts|dokter|ziekenhuis)\b/i
    );

    if (medical) {
      return "Afspraak " + medical[1].toLowerCase();
    }

    if (MEDICINE_WORDS.test(text)) {
      return "Medicatieherinnering";
    }

    let title = text;

    const date = getDate(title);

    if (date.matched) {
      title = title.replace(date.matched, " ");
    }

    title = title
      .replace(/\b(?:om\s+)?\d{1,2}[:.]\d{2}\b/gi, " ")
      .replace(/\s+/g, " ")
      .replace(/^[,;:.!\-\s]+/, "")
      .trim();

    const firstSentence = title.split(/[.!?\n]/)[0].trim();

    if (firstSentence.length >= 4) {
      return firstSentence.slice(0, 100);
    }

    return "Herinnering controleren";
  }

  function buildEntry(lines) {
    const text = lines.join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!text) {
      return null;
    }

    const date = getDate(text);
    const time = getTime(text);
    const location = getLocation(text);

    // Zonder datum of herkenbare taak liever niets voorstellen.
    const meaningful =
      Boolean(date.value) ||
      APPOINTMENT_WORDS.test(text) ||
      TASK_WORDS.test(text) ||
      MEDICINE_WORDS.test(text);

    if (!meaningful) {
      return null;
    }

    const notes = [text];

    if (location) {
      notes.push("Locatie: " + location);
    }

    if (date.assumed) {
      notes.push(
        "Let op: het jaartal is automatisch geschat. Controleer de datum."
      );
    }

    return {
      title: getTitle(text, location),
      entry_type: getEntryType(text),
      event_date: date.value,
      event_time: time,
      recurrence: "none",
      weekday: null,
      priority: getPriority(text),
      notes: notes.join("\n").slice(0, 1000),
      requires_review: true,
      confidence: "low",
      selected: false
    };
  }

  function parse(rawText) {
    const lines = String(rawText || "")
      .split(/\r?\n/)
      .map(cleanLine)
      .filter(Boolean)
      .slice(0, 100);

    if (!lines.length) {
      return [];
    }

    // Haal duidelijke OCR-rommel weg.
    const readable = lines.filter(looksReadable);

    if (!readable.length) {
      return [];
    }

    const groups = [];

    let current = [];
    let currentDate = null;

    for (const line of readable) {
      const detected = getDate(line);

      // Een nieuwe datum kan een nieuwe agenda-afspraak betekenen.
      if (
        detected.value &&
        currentDate &&
        detected.value !== currentDate &&
        current.length
      ) {
        groups.push(current);
        current = [];
      }

      current.push(line);

      if (detected.value) {
        currentDate = detected.value;
      }
    }

    if (current.length) {
      groups.push(current);
    }

    // Maak maximaal 10 voorstellen.
    const entries = groups
      .map(buildEntry)
      .filter(Boolean)
      .slice(0, 10);

    // Verwijder exact dubbele voorstellen.
    const seen = new Set();

    return entries.filter(entry => {
      const key = [
        entry.title.toLowerCase(),
        entry.event_date || "",
        entry.event_time || ""
      ].join("|");

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
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
        "Gebruik een JPG-, PNG- of WebP-afbeelding."
      );
    }

    if (file.size > 12 * 1024 * 1024) {
      throw new Error(
        "De afbeelding is te groot. Maximaal 12 MB."
      );
    }

    const Tesseract = await loadTesseract();

    let worker = null;

    try {
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
                Math.round((message.progress || 0) * 100)
              );
            }
          }
        }
      );

      const response = await worker.recognize(file);

      const data = response.data || {};

      const text = data.text || "";

      const confidence = Number(data.confidence || 0);

      // Lage herkenningskwaliteit: niet automatisch importeren.
      if (confidence < 40) {
        return {
          text,
          entries: [],
          confidence,
          warning:
            "De foto is onvoldoende leesbaar. " +
            "Maak een scherpere foto of voer de afspraak handmatig in."
        };
      }

      const entries = parse(text);

      return {
        text,
        entries,
        confidence,
        warning: entries.length === 0
          ? "Geen betrouwbare afspraken herkend. " +
            "Controleer de foto of voer de afspraak handmatig in."
          : null
      };

    } catch (error) {
      throw new Error(
        "Het uitlezen van de foto is mislukt: " +
        (error?.message || "Onbekende fout")
      );

    } finally {
      if (worker) {
        await worker.terminate();
      }
    }
  }

  window.JustAReminderOCR = {
    version: OCR_VERSION,
    scan,
    parse
  };

})(window);
