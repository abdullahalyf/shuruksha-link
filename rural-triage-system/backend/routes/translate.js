// Shuruksha Link — Translate route
// Lightweight Bengali → English (and any-language → English) translation
// helper used by the frontend before PDF export. The Physician PDF is
// English-only (jsPDF Helvetica is WinAnsi and would render Bengali as
// mojibake), so voice transcripts and OCR text captured in Bengali must be
// translated before they can be safely embedded in the report.
//
// Resilience: same model fallback chain and retry policy as triage.js so
// translation outages don't take down PDF export. On failure the route
// returns the original text untouched — the frontend falls back gracefully
// and the PDF is still produced (with a small "untranslated" annotation).

const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const router = express.Router();

const MODEL_CHAIN = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];
const MAX_RETRIES = 2; // shorter retry budget — this is best-effort
const BASE_BACKOFF_MS = 600;

function isRetryableError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode;
  if (status === 503 || status === 429 || status === 500 || status === 502) return true;
  const msg = String(err.message || err).toLowerCase();
  return (
    msg.includes('503') || msg.includes('429') || msg.includes('500') ||
    msg.includes('unavailable') || msg.includes('overloaded') ||
    msg.includes('econnreset') || msg.includes('etimedout') ||
    msg.includes('network') || msg.includes('fetch failed')
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, label) {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryableError(err) || attempt === MAX_RETRIES) throw err;
      const delay = BASE_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.warn(`[translate] ${label} attempt ${attempt} failed. Retrying in ${delay}ms…`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

// Build a tight translation prompt. We deliberately keep instructions
// short — the only job is faithful English translation of clinical text
// (symptom descriptions, prescription OCR).
function buildPrompt({ text, sourceLanguage }) {
  const langNote = sourceLanguage
    ? `The source language is ${sourceLanguage}.`
    : 'Detect the source language automatically.';
  return [
    'You are a clinical translator for an Indian/Bangladeshi rural-triage system.',
    langNote,
    'Translate the user text into clear, concise English suitable for a',
    'physician\'s report. Preserve all numbers, units, drug names, dosages,',
    'and clinical terms verbatim. Keep the line breaks and overall structure.',
    'Output ONLY the translated English text — no quotes, no preamble,',
    'no language tags, no commentary.',
    '',
    '--- BEGIN TEXT ---',
    text,
    '--- END TEXT ---',
  ].join('\n');
}

// POST /api/translate
// Body: { text: string, sourceLanguage?: 'bn' | 'auto' }
// Response: { translated: string, sourceLanguage: string, modelUsed: string }
router.post('/', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const { text, sourceLanguage = 'auto' } = req.body || {};

  if (typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'No text provided to translate.' });
  }

  // Fast path: if the text is already ASCII / common English, skip the
  // network round-trip entirely. Saves quota and keeps the PDF button snappy
  // when the CHW happens to dictate in English.
  if (/^[\x00-\x7F\s.,;:!?'"()\[\]{}\-_/\\0-9]+$/.test(text)) {
    return res.json({
      translated: text,
      sourceLanguage: 'en',
      modelUsed: 'ascii-skip',
    });
  }

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    // No key configured — return original text so the PDF still renders.
    return res.json({
      translated: text,
      sourceLanguage: sourceLanguage,
      modelUsed: 'no-key-fallback',
      warning: 'GEMINI_API_KEY not configured; translation skipped.',
    });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const prompt = buildPrompt({ text, sourceLanguage });

    let translated = null;
    let winningModel = null;
    let lastErr = null;

    for (const modelName of MODEL_CHAIN) {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.1, // low temperature for faithful translation
          maxOutputTokens: 2048,
        },
      });
      try {
        const result = await withRetry(
          () => model.generateContent(prompt),
          modelName
        );
        translated = (result?.response?.text?.() || '').trim();
        winningModel = modelName;
        if (translated) break;
      } catch (err) {
        lastErr = err;
        console.warn(
          `[translate] ${modelName} exhausted (${MODEL_CHAIN.indexOf(modelName) === MODEL_CHAIN.length - 1 ? 'no fallback' : 'falling back'}).`
        );
      }
    }

    if (!translated) {
      // Translation failed for all models — return original text so the
      // PDF still gets produced. The frontend can surface a warning.
      console.warn('[translate] All models failed. Returning original text.', lastErr?.message);
      return res.json({
        translated: text,
        sourceLanguage: sourceLanguage,
        modelUsed: 'all-models-failed',
        warning: 'Translation unavailable; original text returned.',
      });
    }

    return res.json({
      translated,
      sourceLanguage: sourceLanguage === 'auto' ? 'detected' : sourceLanguage,
      modelUsed: winningModel,
    });
  } catch (err) {
    console.error('[translate] Unexpected error:', err);
    return res.status(500).json({
      translated: text, // graceful fallback
      sourceLanguage: sourceLanguage,
      modelUsed: 'error-fallback',
      error: 'Translation failed unexpectedly.',
    });
  }
});

module.exports = router;
