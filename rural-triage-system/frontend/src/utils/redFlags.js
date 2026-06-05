// Shuruksha Link - Red Flags Engine (Step 16).
// Deterministic, pre-Gemini override. If any of these conditions fire, the
// triage verdict is forced to CRITICAL and the referral is forced to
// "immediate" regardless of what Gemini would otherwise have returned.
//
// Two input classes:
//   1. Numeric vitals: SpO2, temperature, heart rate, glucose, BP (systolic/diastolic).
//   2. Free-text keywords from the voice transcript + OCR text.
//
// Pure: no side effects, no network, safe to run on every keystroke.

// Critical vitals thresholds. BP is parsed from the "120/80" string format
// used by the VitalsForm input. We intentionally do NOT flag BP in
// checkVitals.js (the existing soft-threshold layer) - the emergency
// thresholds live here so the two layers stay independent.
const CRITICAL_RULES = [
  {
    key: 'oxygen',
    label: 'Oxygen saturation',
    test: (v) => num(v) != null && num(v) < 90,
    message: (v) => `SpO2 ${v}% is critically low (< 90%).`,
  },
  {
    key: 'temperature',
    label: 'Body temperature',
    test: (v) => num(v) != null && num(v) >= 40,
    message: (v) => `Temperature ${v}°C is critically high (>= 40°C).`,
  },
  {
    key: 'heartRate',
    label: 'Heart rate',
    test: (v) => num(v) != null && num(v) >= 150,
    message: (v) => `Heart rate ${v} bpm is critically high (>= 150 bpm).`,
  },
  {
    key: 'glucose',
    label: 'Blood glucose',
    test: (v) => num(v) != null && num(v) >= 400,
    message: (v) => `Blood glucose ${v} mg/dL is critically high (>= 400).`,
  },
  {
    key: 'bp',
    label: 'Blood pressure (systolic)',
    test: (_v, parsed) => parsed.systolic != null && parsed.systolic >= 180,
    message: (_v, parsed) =>
      `Systolic BP ${parsed.systolic} mmHg is critically high (>= 180).`,
  },
  {
    key: 'bp',
    label: 'Blood pressure (diastolic)',
    test: (_v, parsed) => parsed.diastolic != null && parsed.diastolic >= 120,
    message: (_v, parsed) =>
      `Diastolic BP ${parsed.diastolic} mmHg is critically high (>= 120).`,
  },
];

// Free-text emergency keywords. Matched case-insensitively as whole-word
// tokens so "unconsciousness" does not falsely match "unconscious", and
// "bleeding" is not triggered by "non-bleeding". A short stem-match is also
// applied to catch common plural / suffix variants.
const TEXT_KEYWORDS = [
  {
    pattern: /\b(unconscious|unresponsive|faint(?:ed|ing)?|passed\s*out)\b/i,
    message: () => 'Patient is reported unconscious or unresponsive.',
  },
  {
    pattern: /\b(seizure|seizures|convulsion|convulsions|fitting|fits)\b/i,
    message: () => 'Seizure / convulsion reported.',
  },
  {
    pattern: /\b(severe|heavy|massive|uncontrolled)\s+bleeding\b/i,
    message: () => 'Severe / uncontrolled bleeding reported.',
  },
  {
    pattern: /\b(not\s+breathing|stopped\s+breathing|choking|suffocat(?:ing|ed))\b/i,
    message: () => 'Patient is reported not breathing.',
  },
];

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Parse a "120/80" or "120 / 80" BP string. Returns { systolic, diastolic }.
function parseBp(bp) {
  if (bp == null) return { systolic: null, diastolic: null };
  const s = String(bp).trim();
  if (!s) return { systolic: null, diastolic: null };
  const m = s.match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  if (!m) return { systolic: null, diastolic: null };
  const systolic = num(m[1]);
  const diastolic = num(m[2]);
  return { systolic, diastolic };
}

/**
 * Evaluate a vitals + free-text bundle and return red-flag findings.
 * @param {{
 *   vitals?: { bp?: string, heartRate?: string|number, temperature?: string|number, oxygen?: string|number, glucose?: string|number },
 *   voiceText?: string,
 *   ocrText?: string,
 * }} input
 * @returns {{ emergency: boolean, reasons: string[] }}
 */
export function evaluateRedFlags(input = {}) {
  const { vitals = {}, voiceText = '', ocrText = '' } = input;
  const reasons = [];

  const parsedBp = parseBp(vitals.bp);
  for (const rule of CRITICAL_RULES) {
    const raw = vitals[rule.key];
    if (rule.test(raw, parsedBp)) {
      reasons.push(rule.message(raw, parsedBp));
    }
  }

  const combinedText = `${voiceText || ''}\n${ocrText || ''}`;
  if (combinedText.trim()) {
    for (const kw of TEXT_KEYWORDS) {
      if (kw.pattern.test(combinedText)) {
        reasons.push(kw.message());
      }
    }
  }

  return { emergency: reasons.length > 0, reasons };
}

// Exported helpers - keep the rules inspectable from devtools and from
// future unit tests.
export const RED_FLAG_RULES = {
  vitals: CRITICAL_RULES,
  textKeywords: TEXT_KEYWORDS,
};
