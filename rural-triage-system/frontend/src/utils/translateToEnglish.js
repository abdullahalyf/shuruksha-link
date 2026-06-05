// Shuruksha Link — translateToEnglish utility
// Thin wrapper around POST /api/translate. Used by the PDF export pipeline
// to convert Bengali (or any non-English) voice/OCR text into English
// BEFORE the data is handed to jsPDF, which can only render WinAnsi glyphs
// from its bundled Helvetica/Courier fonts.
//
// Design notes:
//   - Pure best-effort helper. Network failures, server errors, and
//     non-string inputs are caught and the ORIGINAL text is returned
//     untouched. This keeps PDF generation resilient — a translation
//     outage never blocks the CHW from producing a report.
//   - Includes a fast-path ASCII skip so English text doesn't pay the
//     cost of a network round-trip.
//   - The server already does its own ASCII skip; the client check here
//     is just a latency optimization for the common case.

import { translateUrl } from './apiBase';

// Detects text that contains any non-ASCII characters. The Physician PDF
// is English-only, so anything outside WinAnsi (Bengali, Devanagari, etc.)
// must be translated before embedding in the report.
export function containsNonAscii(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  // eslint-disable-next-line no-control-regex
  return /[^\x00-\x7F]/.test(text);
}

// Translate one block of text to English. Returns the ORIGINAL text on
// any failure (network down, server error, non-string input, timeout).
export async function translateToEnglish(text, { sourceLanguage = 'auto', signal } = {}) {
  if (typeof text !== 'string' || text.trim().length === 0) return text || '';
  if (!containsNonAscii(text)) return text; // fast path: already English

  const url = translateUrl();
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sourceLanguage }),
      signal,
    });
    if (!res.ok) {
      console.warn(`[translateToEnglish] HTTP ${res.status} from ${url}. Falling back to original text.`);
      return text;
    }
    const data = await res.json().catch(() => null);
    if (!data || typeof data.translated !== 'string' || data.translated.length === 0) {
      console.warn('[translateToEnglish] Empty/invalid response. Falling back to original text.');
      return text;
    }
    return data.translated;
  } catch (err) {
    if (err?.name === 'AbortError') {
      console.warn('[translateToEnglish] Request aborted.');
      throw err; // let the caller decide what to do on abort
    }
    console.warn(`[translateToEnglish] Fetch failed (${err?.message || err}). Falling back to original text.`);
    return text;
  }
}

// Translate a batch of named fields in parallel. Returns an object with
// the same keys; missing/non-string values pass through unchanged. The
// `signal` is shared across all requests so the caller can cancel the
// whole batch (e.g. when the user navigates away).
export async function translateFields(fields, { sourceLanguage = 'auto', signal } = {}) {
  const entries = Object.entries(fields);
  const translated = await Promise.all(
    entries.map(([key, value]) =>
      translateToEnglish(value, { sourceLanguage, signal })
        .then((translatedValue) => [key, translatedValue])
        .catch(() => [key, value]) // on abort/error, keep original
    )
  );
  return Object.fromEntries(translated);
}
