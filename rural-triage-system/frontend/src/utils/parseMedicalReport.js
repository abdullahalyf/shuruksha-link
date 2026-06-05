// Shuruksha Link — Structured Medical OCR Parser
// ---------------------------------------------------------------------------
// Upgrades the OCR pipeline from "raw text blob sent to Gemini" to a
// deterministic, rule-based extraction of common lab values.
//
// Inputs:  a free-form string (OCR'd prescription / lab report)
// Outputs: { labs, labAlerts }
//
//   labs: {
//     hemoglobin?, wbc?, platelet?, rbc?, esr?, neutrophils?, lymphocytes?,
//     glucose?, creatinine?, urea?, spo2?, temperature?  // 2-3 of these can
//     come from the same report depending on content
//   }
//
//   labAlerts: string[]  // one human-readable message per triggered rule
//
// Design notes
// ------------
// - Pure function. No I/O, no async. Safe to run on every keystroke from
//   the OCR pipeline (we do that in App.jsx via useMemo on ocrText).
// - Regex patterns are intentionally forgiving (case-insensitive, allow
//   spaces and punctuation around the colon/equals sign) so they survive
//   Tesseract's typical output, which is messy.
// - The threshold table is the *clinical* source of truth for flag
//   generation. If a value is present, we flag it; if absent, we silently
//   skip. No "missing data" alerts on purpose — partial lab reports are
//   the norm in rural Bangladesh and we don't want to alarm the CHW
//   every time.
// - Hemoglobin is reported in g/dL; platelets in /µL; WBC in /µL (we
//   auto-detect the "k"/"thousand" multiplier when present, e.g.
//   "WBC 11k" → 11,000).
// - The thresholds are conservative (slightly broader than the strict
//   normal range) so that borderline cases are escalated, not missed.
//   They are the same thresholds the backend's safety-floor would
//   produce for vitals, so the LLM sees a consistent clinical picture.

const NUMBER = String.raw`(\d{1,3}(?:[, \s]\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)`;
const SEP = String.raw`\s*[:=＝\-]?\s*`;

// Each entry tries multiple regex variants. The first match wins.
// Order matters — more specific patterns first.
const LAB_PATTERNS = [
  {
    key: 'hemoglobin',
    // Hb, Hgb, Haemoglobin, Hemoglobin
    label: 'Hemoglobin',
    unit: 'g/dL',
    patterns: [
      new RegExp(`(?:h(?:a?e)?moglobin|hgb|hb)${SEP}${NUMBER}`, 'i'),
    ],
  },
  {
    key: 'wbc',
    label: 'WBC',
    unit: '/µL',
    patterns: [
      // Matches "WBC 11000", "WBC: 11,000", "WBC 11k", "Total leukocyte count 11000"
      new RegExp(`\\bwbc${SEP}${NUMBER}\\s*k?\\b`, 'i'),
      new RegExp(`total\\s*leukocyte\\s*count${SEP}${NUMBER}`, 'i'),
      new RegExp(`tlc${SEP}${NUMBER}`, 'i'),
    ],
  },
  {
    key: 'platelet',
    label: 'Platelet Count',
    unit: '/µL',
    patterns: [
      new RegExp(`platelet(?:\\s*count)?${SEP}${NUMBER}\\s*k?`, 'i'),
      new RegExp(`plt${SEP}${NUMBER}\\s*k?`, 'i'),
      new RegExp(`thrombocyte${SEP}${NUMBER}`, 'i'),
    ],
  },
  {
    key: 'rbc',
    label: 'RBC',
    unit: 'million/µL',
    patterns: [
      new RegExp(`\\brbc${SEP}${NUMBER}`, 'i'),
      new RegExp(`red\\s*blood\\s*cell(?:\\s*count)?${SEP}${NUMBER}`, 'i'),
    ],
  },
  {
    key: 'esr',
    label: 'ESR',
    unit: 'mm/hr',
    patterns: [
      new RegExp(`\\besr${SEP}${NUMBER}`, 'i'),
      new RegExp(`erythrocyte\\s*sedimentation\\s*rate${SEP}${NUMBER}`, 'i'),
    ],
  },
  {
    key: 'neutrophils',
    label: 'Neutrophils',
    unit: '%',
    patterns: [
      new RegExp(`neutrophils?${SEP}${NUMBER}\\s*%?`, 'i'),
      new RegExp(`\\bneut\\.?${SEP}${NUMBER}`, 'i'),
    ],
  },
  {
    key: 'lymphocytes',
    label: 'Lymphocytes',
    unit: '%',
    patterns: [
      new RegExp(`lymphocytes?${SEP}${NUMBER}\\s*%?`, 'i'),
      new RegExp(`\\blymph\\.?${SEP}${NUMBER}`, 'i'),
    ],
  },
  {
    key: 'glucose',
    label: 'Blood Glucose',
    unit: 'mg/dL',
    // Could appear in lab report as fasting/random/post-prandial glucose.
    // The vitals form already has a glucose field; this catches the
    // lab value too. We prefer the lab value when both exist.
    patterns: [
      new RegExp(
        `(?:fasting|random|pp|post[- ]prandial)?\\s*glucose${SEP}${NUMBER}`,
        'i'
      ),
      new RegExp(`blood\\s*sugar${SEP}${NUMBER}`, 'i'),
    ],
  },
  {
    key: 'creatinine',
    label: 'Creatinine',
    unit: 'mg/dL',
    patterns: [
      new RegExp(`creatinine${SEP}${NUMBER}`, 'i'),
      new RegExp(`\\bs\\.?cr\\.?${SEP}${NUMBER}`, 'i'),
    ],
  },
  {
    key: 'urea',
    label: 'Urea',
    unit: 'mg/dL',
    patterns: [
      new RegExp(`\\burea${SEP}${NUMBER}`, 'i'),
      new RegExp(`blood\\s*urea(?:\\s*nitrogen)?${SEP}${NUMBER}`, 'i'),
      new RegExp(`\\bbun${SEP}${NUMBER}`, 'i'),
    ],
  },
];

// --- Threshold table -------------------------------------------------------
// Each entry: { key, evaluate(value) -> { status: 'NORMAL'|'LOW'|'HIGH'|'CRITICAL', alert?: string } }
//
// Thresholds (deliberately conservative for safety in a CHW context):
//   Hemoglobin:        M 13-17, F 12-15 g/dL  → <7 critical, <10 low, >20 high
//   WBC:               4,000-11,000 /µL       → <2k crit, <4k low, >20k crit, >11k high
//   Platelet:          150,000-400,000 /µL    → <50k crit, <150k low, >450k high
//   RBC:               M 4.7-6.1, F 4.2-5.4 M/µL → <3 low, >7 high
//   ESR:               M 0-15, F 0-20 mm/hr   → >30 high (inflammation marker)
//   Neutrophils:       40-70 %                → <40 low, >80 high
//   Lymphocytes:       20-40 %                → <20 low, >50 high
//   Glucose:           70-140 mg/dL fasting   → <60 crit, <70 low, >200 high, >300 crit
//   Creatinine:        0.6-1.3 mg/dL          → >1.5 high, >3.0 critical
//   Urea:              15-40 mg/dL            → >50 high, >100 critical
//
// Note: we don't try to be sex-aware in the parser (OCR rarely tells us
// the sex), so hemoglobin uses the more permissive female upper bound.

const THRESHOLDS = [
  {
    key: 'hemoglobin',
    evaluate: (v) => {
      if (v < 7) return { status: 'CRITICAL', alert: 'CRITICAL ANEMIA ALERT' };
      if (v < 10) return { status: 'LOW', alert: 'LOW HEMOGLOBIN ALERT' };
      if (v > 20) return { status: 'HIGH', alert: 'POLYCYTHEMIA ALERT' };
      return { status: 'NORMAL' };
    },
  },
  {
    key: 'wbc',
    evaluate: (v) => {
      if (v < 2000) return { status: 'CRITICAL', alert: 'SEVERE LEUKOPENIA ALERT' };
      if (v > 20000) return { status: 'CRITICAL', alert: 'LEUKOCYTOSIS / SEPSIS ALERT' };
      if (v < 4000) return { status: 'LOW', alert: 'LOW WBC ALERT' };
      if (v > 11000) return { status: 'HIGH', alert: 'ELEVATED WBC ALERT' };
      return { status: 'NORMAL' };
    },
  },
  {
    key: 'platelet',
    evaluate: (v) => {
      if (v < 50000) return { status: 'CRITICAL', alert: 'SEVERE THROMBOCYTOPENIA ALERT' };
      if (v < 150000) return { status: 'LOW', alert: 'LOW PLATELET ALERT' };
      if (v > 450000) return { status: 'HIGH', alert: 'THROMBOCYTOSIS ALERT' };
      return { status: 'NORMAL' };
    },
  },
  {
    key: 'rbc',
    evaluate: (v) => {
      if (v < 3) return { status: 'LOW', alert: 'LOW RBC ALERT' };
      if (v > 7) return { status: 'HIGH', alert: 'HIGH RBC ALERT' };
      return { status: 'NORMAL' };
    },
  },
  {
    key: 'esr',
    evaluate: (v) => {
      if (v > 30) return { status: 'HIGH', alert: 'ELEVATED ESR ALERT' };
      return { status: 'NORMAL' };
    },
  },
  {
    key: 'neutrophils',
    evaluate: (v) => {
      if (v < 40) return { status: 'LOW', alert: 'NEUTROPENIA ALERT' };
      if (v > 80) return { status: 'HIGH', alert: 'NEUTROPHILIA ALERT' };
      return { status: 'NORMAL' };
    },
  },
  {
    key: 'lymphocytes',
    evaluate: (v) => {
      if (v < 20) return { status: 'LOW', alert: 'LYMPHOPENIA ALERT' };
      if (v > 50) return { status: 'HIGH', alert: 'LYMPHOCYTOSIS ALERT' };
      return { status: 'NORMAL' };
    },
  },
  {
    key: 'glucose',
    evaluate: (v) => {
      if (v < 60) return { status: 'CRITICAL', alert: 'HYPOGLYCEMIA ALERT' };
      if (v < 70) return { status: 'LOW', alert: 'LOW GLUCOSE ALERT' };
      if (v > 300) return { status: 'CRITICAL', alert: 'HYPERGLYCEMIA ALERT' };
      if (v > 200) return { status: 'HIGH', alert: 'HYPERGLYCEMIA ALERT' };
      return { status: 'NORMAL' };
    },
  },
  {
    key: 'creatinine',
    evaluate: (v) => {
      if (v > 3.0) return { status: 'CRITICAL', alert: 'ACUTE KIDNEY INJURY ALERT' };
      if (v > 1.5) return { status: 'HIGH', alert: 'ELEVATED CREATININE ALERT' };
      return { status: 'NORMAL' };
    },
  },
  {
    key: 'urea',
    evaluate: (v) => {
      if (v > 100) return { status: 'CRITICAL', alert: 'UREMIC TOXICITY ALERT' };
      if (v > 50) return { status: 'HIGH', alert: 'ELEVATED UREA ALERT' };
      return { status: 'NORMAL' };
    },
  },
];

// --- Internal helpers ------------------------------------------------------

/**
 * Parse a single matched number string ("11", "11,000", "11 000", "11.5")
 * into a Number. Returns NaN on failure.
 */
function parseNumber(raw) {
  if (raw == null) return NaN;
  // Strip spaces (incl. non-breaking) and commas used as thousands separators.
  const cleaned = String(raw).replace(/[ ,]/g, '').trim();
  return Number(cleaned);
}

/**
 * Read the "k" / "thousand" multiplier from a context window immediately
 * after a matched number. E.g. "WBC 11k" → 11000, "WBC 11 thousand" → 11000.
 */
function applyKMultiplier(value, text, matchIndex) {
  if (!Number.isFinite(value)) return value;
  // Look at up to 12 chars after the match
  const tail = text.slice(matchIndex, matchIndex + 12).toLowerCase();
  if (/^k\b/.test(tail) || /^thousand/.test(tail)) return value * 1000;
  return value;
}

/**
 * Try every pattern for one lab field. First match wins.
 * Returns { value, matchIndex } or null.
 */
function extractField(field, text) {
  for (const pattern of field.patterns) {
    const m = text.match(pattern);
    if (!m) continue;
    const rawNumber = m[1];
    const value = applyKMultiplier(parseNumber(rawNumber), text, m.index + m[0].length);
    if (Number.isFinite(value)) {
      return { value, matchIndex: m.index };
    }
  }
  return null;
}

// --- Public API ------------------------------------------------------------

/**
 * Parse free-form OCR text into a structured lab findings object.
 *
 * @param {string} ocrText  The raw OCR string.
 * @returns {{ labs: object, labAlerts: string[] }}
 *   labs:     key→number, only present when a value was extracted
 *   labAlerts: human-readable alert messages (one per triggered rule)
 */
export function parseMedicalReport(ocrText) {
  const labs = {};
  const labAlerts = [];

  if (!ocrText || typeof ocrText !== 'string' || ocrText.trim() === '') {
    return { labs, labAlerts };
  }

  for (const field of LAB_PATTERNS) {
    const found = extractField(field, ocrText);
    if (!found) continue;
    labs[field.key] = found.value;

    // Apply threshold
    const rule = THRESHOLDS.find((t) => t.key === field.key);
    if (rule) {
      const verdict = rule.evaluate(found.value);
      labs[`${field.key}_status`] = verdict.status;
      if (verdict.alert) {
        // Inject the actual value for context
        const valueText =
          field.key === 'platelet' || field.key === 'wbc'
            ? `${found.value.toLocaleString('en-US')} ${field.unit}`
            : `${found.value} ${field.unit}`;
        labAlerts.push(`${verdict.alert} (${field.label}: ${valueText})`);
      }
    }
  }

  return { labs, labAlerts };
}

/**
 * Metadata for the UI / PDF. Returns the ordered list of (key, label, unit)
 * for every lab we know how to extract, plus a "valueOf(labs, key)" helper.
 */
export const LAB_FIELDS = LAB_PATTERNS.map((f) => ({
  key: f.key,
  label: f.label,
  unit: f.unit,
}));

export const LAB_THRESHOLDS = THRESHOLDS;

export default parseMedicalReport;
