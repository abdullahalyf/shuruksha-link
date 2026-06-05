// Shuruksha Link — Triage route
// Receives a structured payload (vitals + alerts + voice + OCR), builds a
// controlled prompt, calls Google Gemini, and returns a strict JSON shape
// consumed by the frontend's TriageResult component.
//
// Resilience:
//   - Tries models in order: gemini-2.5-flash → gemini-2.0-flash → gemini-1.5-flash
//   - Retries each model up to 3 times with exponential backoff (1s, 2s, 4s)
//   - Only retries on transient errors (503, 429, 500, network blips)
//   - Returns friendly messages to the user; raw errors go to the server log

const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const router = express.Router();

// --- Model fallback chain --------------------------------------------------
// Ordered from preferred → most compatible. We try each one in turn; only
// fall back if every retry of the current model fails.
const MODEL_CHAIN = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000; // 1s, 2s, 4s

// --- Error classification --------------------------------------------------
// The GoogleGenerativeAI SDK throws errors with a `.status` and a `.statusText`
// field on HTTP failures, and plain `Error` objects on network blips.
// We inspect the message string as a fallback for older SDK behavior.
function isRetryableError(err) {
  if (!err) return false;
  const status = err.status || err.statusCode;
  if (status === 503 || status === 429 || status === 500 || status === 502) {
    return true;
  }
  const msg = String(err.message || err).toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('503') ||
    msg.includes('429') ||
    msg.includes('500') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('internal error') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    msg.includes('fetch failed')
  );
}

function userMessageFor(err) {
  const status = err?.status || err?.statusCode;
  const msg = String(err?.message || '').toLowerCase();

  if (status === 429 || msg.includes('429') || msg.includes('quota')) {
    return 'The AI service has reached its request quota. Please wait a minute and retry.';
  }
  if (
    status === 503 ||
    msg.includes('503') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('overloaded')
  ) {
    return 'The AI service is temporarily overloaded. Please retry in a moment.';
  }
  if (status === 500 || msg.includes('500') || msg.includes('internal error')) {
    return 'The AI service returned an internal error. Please retry.';
  }
  if (
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    msg.includes('fetch failed')
  ) {
    return 'Network problem reaching the AI service. Please check connectivity and retry.';
  }
  if (status === 401 || status === 403 || msg.includes('api key')) {
    return 'Server is not authorized to reach the AI service. Please contact the administrator.';
  }
  return 'Triage service is temporarily unavailable. Please retry shortly.';
}

// --- Retry helper ----------------------------------------------------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, label) {
  // Try the call up to MAX_RETRIES times with exponential backoff.
  // Returns the successful result, or throws the LAST error if every attempt failed.
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) {
        console.log(`[triage] ${label} succeeded on attempt ${attempt}.`);
      }
      return result;
    } catch (err) {
      lastErr = err;
      if (!isRetryableError(err) || attempt === MAX_RETRIES) {
        // Either a non-retryable error, or we've burned all retries.
        throw err;
      }
      const delay = BASE_BACKOFF_MS * Math.pow(2, attempt - 1); // 1s, 2s, 4s
      console.warn(
        `[triage] ${label} attempt ${attempt} failed (${err.status || ''} ${err.message || err}). ` +
        `Retrying in ${delay}ms…`
      );
      await sleep(delay);
    }
  }
  // Unreachable, but keep TS-style safety.
  throw lastErr;
}

// --- JSON schema enforced via Gemini's responseSchema -----------------------
// Keeps the model honest about the keys the UI needs.
const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    severity: {
      type: 'string',
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      description: 'Triage severity bucket.',
    },
    summary: {
      type: 'string',
      description: '1-2 sentence clinical summary for the CHW.',
    },
    possible_conditions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Short list of differential diagnoses or working impressions.',
    },
    recommended_actions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Ordered list of immediate first-aid / next steps.',
    },
    referral: {
      type: 'string',
      description: 'Referral guidance — e.g. "Refer to Upazila Health Complex within 24 hours".',
    },
    confidence: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
      description: 'Model self-assessed confidence in the verdict.',
    },
  },
  required: [
    'severity',
    'summary',
    'possible_conditions',
    'recommended_actions',
    'referral',
    'confidence',
  ],
};

// --- Defensive server-side severity override --------------------------------
// If the local anomaly detector flagged something critical, force the
// minimum severity regardless of what the model says. This is a safety net
// because the LLM might downplay clear vitals abnormalities.
const ALERT_SEVERITY_MAP = [
  { match: /oxygen|spo2|sp[\s_]?o2/i, min: 'HIGH' },
  { match: /temperature|fever/i, min: 'MEDIUM' },
  { match: /heart rate|pulse|tachycardia|bradycardia/i, min: 'MEDIUM' },
  { match: /glucose|blood sugar/i, min: 'MEDIUM' },
];

// CRITICAL lab alerts force CRITICAL severity (e.g. critical thrombocytopenia
// in suspected dengue, DKA-range glucose, AKI, severe anemia).
const CRITICAL_LAB_PATTERNS = [
  /critical\s+thrombocytopenia|critical\s+platelet|platelet.*<\s*50|<\s*50,?000.*platelet|platelet.*critically/i,
  /critical\s+anemia|hemoglobin.*<\s*7|hb\s*<\s*7|severe\s+anemia/i,
  /critical\s+hyperglycemia|dk[a]|glucose.*>\s*400|>\s*400.*glucose/i,
  /critical\s+hypoglycemia|glucose.*<\s*50|<\s*50.*glucose/i,
  /acute\s+kidney\s+injury|critical\s+creatinine|creatinine.*>\s*5|>\s*5.*creatinine/i,
  /critical\s+leukocytosis|septic|wbc.*>\s*30,?000|>\s*30,?000.*wbc/i,
];

// HIGH lab alerts force at least HIGH severity.
const HIGH_LAB_PATTERNS = [
  /thrombocytopenia|low\s+platelet|platelet.*<\s*150/i,
  /anemia|low\s+hemoglobin|hb\s*<\s*10/i,
  /hyperglycemia|high\s+glucose|glucose.*>\s*200|>\s*200.*glucose/i,
  /leukocytosis|high\s+wbc|wbc.*>\s*15,?000|>\s*15,?000.*wbc/i,
  /leukopenia|low\s+wbc|wbc.*<\s*4,?000|<\s*4,?000.*wbc/i,
  /high\s+creatinine|elevated\s+creatinine|creatinine.*>\s*1\.5/i,
  /high\s+urea|elevated\s+urea|urea.*>\s*50/i,
  /high\s+esr|elevated\s+esr|esr.*>\s*30/i,
];

const SEVERITY_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

function applySafetyFloor(verdict, alerts, labAlerts, redFlags) {
  let floor = 'LOW';
  let overrideReason = '';

  // Vitals-derived alerts
  if (Array.isArray(alerts) && alerts.length > 0) {
    for (const a of alerts) {
      for (const rule of ALERT_SEVERITY_MAP) {
        if (rule.match.test(a) && SEVERITY_RANK[rule.min] > SEVERITY_RANK[floor]) {
          floor = rule.min;
        }
      }
    }
    // SpO2 < 90 in alerts (text contains "oxygen" with very low) → CRITICAL floor.
    const criticalPattern = /(oxygen|spo2)[^\n]{0,40}(<\s*90|below\s*90|critical)/i;
    if (alerts.some((a) => criticalPattern.test(a))) {
      floor = 'CRITICAL';
      overrideReason = 'vitals SpO2 < 90';
    }
  }

  // Lab-derived alerts override vitals floor upwards.
  if (Array.isArray(labAlerts) && labAlerts.length > 0) {
    const text = labAlerts.join('\n');
    if (CRITICAL_LAB_PATTERNS.some((p) => p.test(text))) {
      floor = 'CRITICAL';
      overrideReason = overrideReason || 'critical lab alert';
    } else if (HIGH_LAB_PATTERNS.some((p) => p.test(text))) {
      if (SEVERITY_RANK['HIGH'] > SEVERITY_RANK[floor]) {
        floor = 'HIGH';
        overrideReason = overrideReason || 'abnormal lab alert';
      }
    }
  }

  // Emergency red-flag override (Step 16): if the frontend red-flag engine
  // flagged the case as an emergency, force CRITICAL severity and an
  // "immediate" referral. This is a hard floor - it is never downgraded
  // back to a milder bucket.
  const emergencyActive =
    redFlags && redFlags.emergency === true &&
    Array.isArray(redFlags.reasons) && redFlags.reasons.length > 0;
  if (emergencyActive) {
    floor = 'CRITICAL';
    overrideReason = overrideReason || 'red-flag emergency';
  }

  if (SEVERITY_RANK[floor] > SEVERITY_RANK[verdict.severity]) {
    const reasonSuffix = overrideReason
      ? ' (reason: ' + overrideReason + ')'
      : '';
    const reasonsLine = emergencyActive
      ? ' Red-flag reasons: ' + redFlags.reasons.join('; ') + '.'
      : '';
    return {
      ...verdict,
      severity: floor,
      summary:
        verdict.summary +
        ' [Safety override: local anomaly detector raised severity to ' +
        floor +
        reasonSuffix +
        '.' +
        reasonsLine +
        ']',
    };
  }

  // Even when the verdict's own severity is already at the floor, an
  // emergency still forces the referral copy to be unambiguous.
  if (emergencyActive) {
    return {
      ...verdict,
      severity: 'CRITICAL',
      referral:
        'Refer to Upazila Health Complex / district hospital IMMEDIATELY. Do not delay - call for ambulance now.',
    };
  }

  return verdict;
}

// --- Prompt builder --------------------------------------------------------
// Step 17: multilingual prompt. `outputLanguage` is 'en' (default) or 'bn'.
function buildPrompt({ vitals, alerts, voiceTranscript, ocrText, labFindings, labAlerts, outputLanguage }) {
  const safeAlerts = Array.isArray(alerts) ? alerts : [];
  const safeLabAlerts = Array.isArray(labAlerts) ? labAlerts : [];

  const v = (k) => (vitals && (vitals[k] === '' || vitals[k] == null) ? '-' : String(vitals[k]));

  // Render the structured lab findings into a compact text block. Only
  // include keys that have a numeric value; we leave the status tag in
  // parens so the LLM doesn't have to guess.
  const labLines = Object.keys(labFindings || {})
    .filter((k) => !k.endsWith('_status') && labFindings[k] != null)
    .map((k) => {
      const status = labFindings[`${k}_status`] || 'UNKNOWN';
      return `  - ${k}: ${labFindings[k]} (${status})`;
    });

  // Step 17 — multilingual output. Only the four narrative fields
  // (summary, possible_conditions, recommended_actions, referral) are
  // translated; severity / confidence are enum keys and stay in English.
  const language = (outputLanguage === 'bn' || outputLanguage === 'bangla') ? 'bn' : 'en';
  const languageBlock = language === 'bn'
    ? [
        '',
        'LANGUAGE — IMPORTANT:',
        'Write all four narrative fields (summary, possible_conditions,',
        'recommended_actions, referral) in natural Bengali (বাংলা). Use',
        'Bangla script throughout. Keep the JSON keys in English. Keep',
        'medical terms readable for a Community Health Worker (e.g.',
        '"রক্তচাপ", "জ্বর", "ডায়রিয়া", "প্লাটিলেট"). Do not transliterate.',
        'severity and confidence MUST remain in the English enum values',
        '(LOW / MEDIUM / HIGH / CRITICAL, low / medium / high).',
      ]
    : [
        '',
        'LANGUAGE — IMPORTANT:',
        'Write all four narrative fields (summary, possible_conditions,',
        'recommended_actions, referral) in clear, simple English suitable',
        'for a Community Health Worker. severity and confidence MUST',
        'remain in the English enum values (LOW / MEDIUM / HIGH / CRITICAL,',
        'low / medium / high).',
      ];

  return [
    'You are a clinical decision-support assistant for Community Health Workers (CHWs)',
    'in rural Bangladesh. You are NOT a doctor. You help the CHW decide whether the',
    'patient needs immediate referral, urgent care within hours, routine follow-up,',
    'or can be observed at home.',
    '',
    'Patient context:',
    `- Blood pressure: ${v('bp')} mmHg`,
    `- Heart rate: ${v('heartRate')} bpm`,
    `- Temperature: ${v('temperature')} °C`,
    `- SpO2: ${v('oxygen')} %`,
    `- Blood glucose: ${v('glucose')} mg/dL`,
    '',
    'Local anomaly detector alerts (vitals-derived):',
    alerts.length ? alerts.map((a, i) => `  ${i + 1}. ${a}`).join('\n') : '  (none)',
    '',
    'Lab findings extracted from uploaded lab report (rule-based extraction):',
    labLines.length ? labLines.join('\n') : '  (no lab values extracted)',
    '',
    'Lab alerts (rule-based medical flags, e.g. thrombocytopenia, anemia, etc.):',
    labAlerts.length ? labAlerts.map((a, i) => `  ${i + 1}. ${a}`).join('\n') : '  (none)',
    '',
    'CHW voice transcript (symptoms as spoken by the patient / family):',
    voiceTranscript ? voiceTranscript : '(none provided)',
    '',
    'OCR text from uploaded prescription / lab report (raw, unparsed):',
    ocrText ? ocrText : '(none provided)',
    '',
    'Produce a triage verdict in STRICT JSON. Choose severity as follows:',
    '  LOW      → stable, can be observed / self-care',
    '  MEDIUM   → needs clinician review within 24-48 h',
    '  HIGH     → needs same-day facility evaluation',
    '  CRITICAL → life-threatening, refer to hospital immediately',
    '',
    'IMPORTANT — when lab findings or lab alerts are present, you MUST explicitly',
    'consider them when generating severity, possible_conditions,',
    'recommended_actions, and referral. Examples of how to reason:',
    '  - Platelet < 50,000 / thrombocytopenia alert  -> think dengue,',
    '    refer for platelet transfusion if symptomatic bleeding.',
    '  - Hemoglobin < 7 / critical anemia alert     -> same-day transfusion,',
    '    add severe anemia to possible_conditions.',
    '  - Creatinine > 3 / AKI alert                  -> refer to facility,',
    '    consider dehydration / obstruction.',
    '  - WBC > 20,000 / leukocytosis alert           -> possible sepsis /',
    '    severe infection, upgrade severity if vitals support it.',
    '  - Glucose > 300 / hyperglycemia alert         -> possible DKA, urgent',
    '    referral even if vitals look otherwise stable.',
    '',
    'If a vitals reading is clearly out of safe range (e.g. SpO2 < 90, severe',
    'tachycardia, very high fever in a child, glucose < 60 or > 300), prefer the',
    'higher severity. Keep summary under 60 words. Keep possible_conditions and',
    'recommended_actions to 3-6 short items each. Write referral in plain',
    'language the CHW can act on. Confidence reflects how complete the input was.',
  ].concat(languageBlock).join('\n');
}

// --- Route handler ---------------------------------------------------------
router.post('/', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    return res.status(500).json({
      error:
        'GEMINI_API_KEY is not configured on the server. Set it in backend/.env and restart.',
    });
  }

  const { vitals, alerts, voiceTranscript, ocrText, labFindings, labAlerts, redFlags, outputLanguage } = req.body || {};

  // Basic shape check â€” don't waste a Gemini call on a totally empty payload.
  const hasLabs =
    (labFindings && Object.values(labFindings).some((x) => x !== '' && x != null)) ||
    (Array.isArray(labAlerts) && labAlerts.length > 0);
  const hasAny =
    (vitals && Object.values(vitals).some((x) => x !== '' && x != null)) ||
    (Array.isArray(alerts) && alerts.length > 0) ||
    (voiceTranscript && voiceTranscript.trim().length > 0) ||
    (ocrText && ocrText.trim().length > 0) ||
    hasLabs;

  // An active emergency flag is treated as clinical data even if every other
  // field is empty - we never reject an emergency as "no data".
  const emergencyActive =
    redFlags && redFlags.emergency === true &&
    Array.isArray(redFlags.reasons) && redFlags.reasons.length > 0;

  if (!hasAny && !emergencyActive) {
    return res.status(400).json({
      error:
        'No clinical data provided. Enter at least one vital, alert, voice note, or OCR text.',
    });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const prompt = buildPrompt({ vitals, alerts, voiceTranscript, ocrText, labFindings, labAlerts, outputLanguage });

    let raw = '';
    let winningModel = null;
    let lastErr = null;

    // Walk the model chain. For each model, retry with backoff. Fall back to
    // the next model only if every retry of the current one is exhausted.
    for (const modelName of MODEL_CHAIN) {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: TRIAGE_SCHEMA,
          temperature: 0.2,
        },
      });

      try {
        const result = await withRetry(
          () => model.generateContent(prompt),
          `${modelName}`
        );
        raw = result?.response?.text?.() || '';
        winningModel = modelName;
        break;
      } catch (err) {
        lastErr = err;
        console.warn(
          `[triage] All ${MAX_RETRIES} retries of ${modelName} exhausted. ` +
          `${MODEL_CHAIN.indexOf(modelName) === MODEL_CHAIN.length - 1 ? 'No more fallbacks.' : 'Falling back to next model.'}`
        );
        // Loop continues to the next model.
      }
    }

    if (!winningModel) {
      // Every model in the chain failed.
      console.error('[triage] All models in fallback chain failed. Last error:', lastErr);
      return res.status(502).json({
        error: userMessageFor(lastErr),
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error(
        `[triage] ${winningModel} returned non-JSON (first 200 chars):`,
        raw.slice(0, 200)
      );
      return res.status(502).json({
        error: 'The AI service returned an unexpected response. Please retry.',
      });
    }

    // Normalize missing arrays to empty arrays so the frontend can render safely.
    const verdict = {
      severity: parsed.severity || 'LOW',
      summary: parsed.summary || '',
      possible_conditions: Array.isArray(parsed.possible_conditions)
        ? parsed.possible_conditions
        : [],
      recommended_actions: Array.isArray(parsed.recommended_actions)
        ? parsed.recommended_actions
        : [],
      referral: parsed.referral || '',
      confidence: parsed.confidence || 'low',
    };

    const safe = applySafetyFloor(verdict, alerts || [], labAlerts || [], redFlags);

    const langTag = (outputLanguage === 'bn' || outputLanguage === 'bangla') ? 'bn' : 'en';
    console.log(`[triage] verdict served via ${winningModel} (severity=${safe.severity}, lang=${langTag}).`);
    return res.json({ ok: true, verdict: safe, model: winningModel });
  } catch (err) {
    // Should be rare — non-Gemini error (e.g. prompt build failure).
    console.error('[triage] Unexpected handler error:', err);
    return res.status(500).json({
      error: userMessageFor(err),
    });
  }
});

module.exports = router;
