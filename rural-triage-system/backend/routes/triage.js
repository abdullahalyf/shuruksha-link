// Shuruksha Link — Triage route
// Receives a structured payload (vitals + alerts + voice + OCR), builds a
// controlled prompt, calls Google Gemini 2.5 Flash, and returns a strict
// JSON shape consumed by the frontend's TriageResult component.

const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const router = express.Router();

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

const SEVERITY_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

function applySafetyFloor(verdict, alerts) {
  if (!Array.isArray(alerts) || alerts.length === 0) return verdict;
  let floor = 'LOW';
  for (const a of alerts) {
    for (const rule of ALERT_SEVERITY_MAP) {
      if (rule.match.test(a) && SEVERITY_RANK[rule.min] > SEVERITY_RANK[floor]) {
        floor = rule.min;
      }
    }
  }
  // SpO2 < 90 in alerts (text contains "oxygen" with very low) → CRITICAL floor.
  const criticalPattern = /(oxygen|spo2)[^\n]{0,40}(<\s*90|below\s*90|critical)/i;
  if (alerts.some((a) => criticalPattern.test(a))) floor = 'CRITICAL';

  if (SEVERITY_RANK[floor] > SEVERITY_RANK[verdict.severity]) {
    return {
      ...verdict,
      severity: floor,
      summary:
        verdict.summary +
        ' [Safety override: local vitals anomaly detector flagged a ' +
        floor +
        '-risk pattern.]',
    };
  }
  return verdict;
}

// --- Prompt construction ---------------------------------------------------
function buildPrompt(payload) {
  const {
    vitals = {},
    alerts = [],
    voiceTranscript = '',
    ocrText = '',
  } = payload || {};

  const v = (k) => (vitals[k] === '' || vitals[k] == null ? '—' : String(vitals[k]));

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
    'Local anomaly detector alerts:',
    alerts.length ? alerts.map((a, i) => `  ${i + 1}. ${a}`).join('\n') : '  (none)',
    '',
    'CHW voice transcript (symptoms as spoken by the patient / family):',
    voiceTranscript ? voiceTranscript : '(none provided)',
    '',
    'OCR text from uploaded prescription / lab report:',
    ocrText ? ocrText : '(none provided)',
    '',
    'Produce a triage verdict in STRICT JSON. Choose severity as follows:',
    '  LOW      → stable, can be observed / self-care',
    '  MEDIUM   → needs clinician review within 24-48 h',
    '  HIGH     → needs same-day facility evaluation',
    '  CRITICAL → life-threatening, refer to hospital immediately',
    '',
    'If a vitals reading is clearly out of safe range (e.g. SpO2 < 90, severe',
    'tachycardia, very high fever in a child, glucose < 60 or > 300), prefer the',
    'higher severity. Keep summary under 60 words. Keep possible_conditions and',
    'recommended_actions to 3-6 short items each. Write referral in plain',
    'language the CHW can act on. Confidence reflects how complete the input was.',
  ].join('\n');
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

  const { vitals, alerts, voiceTranscript, ocrText } = req.body || {};

  // Basic shape check — don't waste a Gemini call on a totally empty payload.
  const hasAny =
    (vitals && Object.values(vitals).some((x) => x !== '' && x != null)) ||
    (Array.isArray(alerts) && alerts.length > 0) ||
    (voiceTranscript && voiceTranscript.trim().length > 0) ||
    (ocrText && ocrText.trim().length > 0);

  if (!hasAny) {
    return res.status(400).json({
      error:
        'No clinical data provided. Enter at least one vital, alert, voice note, or OCR text.',
    });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: TRIAGE_SCHEMA,
        temperature: 0.2,
      },
    });

    const prompt = buildPrompt({ vitals, alerts, voiceTranscript, ocrText });
    const result = await model.generateContent(prompt);
    const raw = result?.response?.text?.() || '';

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error('[triage] Failed to parse Gemini JSON:', raw);
      return res.status(502).json({
        error: 'Gemini returned a non-JSON response. Please retry.',
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

    const safe = applySafetyFloor(verdict, alerts || []);

    return res.json({ ok: true, verdict: safe });
  } catch (err) {
    console.error('[triage] Gemini call failed:', err);
    return res.status(502).json({
      error:
        'Triage service is temporarily unavailable. ' +
        (err?.message || 'Unknown error from upstream model.'),
    });
  }
});

module.exports = router;
