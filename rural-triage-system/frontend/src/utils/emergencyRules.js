// Shuruksha Link — Offline Emergency Rules Engine (Step 22)
// ----------------------------------------------------------
// Deterministic, pre-Gemini override. If ANY critical rule fires, the
// system raises an emergency override regardless of what the AI returns.
//
// Inputs:
//   vitals      { bp, heartRate, temperature, oxygen, glucose }
//   alerts      string[]  (rule-based vitals alerts from checkVitals)
//   labFindings { hemoglobin, wbc, platelet, ... }
//   labAlerts   string[]  (rule-based lab alerts from parseMedicalReport)
//
// Output:
//   {
//     triggered: boolean,
//     severity: 'CRITICAL' | null,
//     reasons:   string[],    // human-readable trigger explanations
//     firstAid:  string[],    // immediate bedside actions for the CHW
//     referral:  string,      // one-line referral recommendation
//   }
//
// Design notes
// ------------
// - Pure: no side effects, no network, no AI. Safe to call on every
//   render of the process handler.
// - Severity is always CRITICAL when triggered — there is no "warning"
//   tier here. This engine is the last-line safety net; the AI
//   verdict is allowed to say MEDIUM, the engine is not.
// - Thresholds match the redFlags engine (utils/redFlags.js) and the
//   lab parser (utils/parseMedicalReport.js) so the three layers
//   agree on what "critical" means.
// - First-aid items are intentionally short, in English, and
//   action-oriented. The CHW is reading them under time pressure.

const REFERRAL_DEFAULT =
  'Refer to hospital immediately. Activate emergency transport.';

const REFERRAL_PLATELET =
  'Refer to a physician or hospital urgently. Avoid IM injections and trauma on the way.';

const REFERRAL_HEMOGLOBIN =
  'Refer to a hospital urgently. Severe anemia requires transfusion evaluation.';

const REFERRAL_WBC =
  'Refer to a hospital urgently. Possible severe infection or leukemia — needs physician review.';

// --- Helpers ---------------------------------------------------------------
function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function labStatusIs(finding, key, predicate) {
  if (!finding || typeof finding !== 'object') return false;
  const raw = finding[key];
  if (raw === '' || raw == null) return false;
  const n = Number(raw);
  if (!Number.isFinite(n)) return false;
  return predicate(n);
}

function hasLabAlert(labAlerts, pattern) {
  if (!Array.isArray(labAlerts)) return false;
  return labAlerts.some((a) => pattern.test(String(a)));
}

// --- Rule table ------------------------------------------------------------
// Each rule returns either null (not triggered) or
//   { reason, firstAid: string[], referral?: string }
const RULES = [
  {
    key: 'oxygen',
    label: 'Oxygen saturation',
    test: ({ vitals }) => {
      const s = num(vitals?.oxygen);
      return s != null && s < 90;
    },
    reason: ({ vitals }) =>
      `SpO2 ${vitals.oxygen}% is critically low (< 90%).`,
    firstAid: [
      'Keep patient sitting upright; do not lay flat.',
      'Loosen any tight clothing around the neck and chest.',
      'Monitor breathing continuously while arranging transport.',
    ],
    referral: REFERRAL_DEFAULT,
  },
  {
    key: 'heartRate',
    label: 'Heart rate',
    test: ({ vitals }) => {
      const hr = num(vitals?.heartRate);
      return hr != null && hr > 140;
    },
    reason: ({ vitals }) =>
      `Heart rate ${vitals.heartRate} bpm is critically high (> 140).`,
    firstAid: [
      'Rest the patient in a cool, quiet place.',
      'Check for fever, dehydration, pain, or bleeding.',
      'Monitor pulse every 5 minutes while arranging transport.',
    ],
    referral: REFERRAL_DEFAULT,
  },
  {
    key: 'temperature',
    label: 'Body temperature',
    test: ({ vitals }) => {
      const t = num(vitals?.temperature);
      return t != null && t > 40;
    },
    reason: ({ vitals }) =>
      `Temperature ${vitals.temperature}°C is critically high (> 40°C).`,
    firstAid: [
      'Cool the patient safely: tepid sponging, light clothing, fanning.',
      'If the patient is conscious and able to swallow, offer small sips of water.',
      'Monitor level of consciousness every few minutes.',
    ],
    referral: REFERRAL_DEFAULT,
  },
  {
    key: 'glucose',
    label: 'Blood glucose',
    test: ({ vitals }) => {
      const g = num(vitals?.glucose);
      return g != null && g > 400;
    },
    reason: ({ vitals }) =>
      `Blood glucose ${vitals.glucose} mg/dL is critically high (> 400).`,
    firstAid: [
      'Do not give food or sugar — glucose is already very high.',
      'Watch for fruity-smelling breath, deep rapid breathing, or drowsiness.',
      'Keep the patient upright and monitor mental status every few minutes.',
    ],
    referral: REFERRAL_DEFAULT,
  },
  {
    key: 'platelet',
    label: 'Platelet count',
    test: ({ labFindings }) =>
      labStatusIs(labFindings, 'platelet', (n) => n < 50000),
    reason: ({ labFindings }) =>
      `Platelet count ${labFindings.platelet} /µL is critically low (< 50,000).`,
    firstAid: [
      'Avoid trauma — no IM injections, no aspirin, no rough handling.',
      'Watch for bleeding (gums, skin petechiae, urine, stool).',
      'Keep the patient calm and still while arranging transport.',
    ],
    referral: REFERRAL_PLATELET,
  },
  {
    key: 'hemoglobin',
    label: 'Hemoglobin',
    test: ({ labFindings }) =>
      labStatusIs(labFindings, 'hemoglobin', (n) => n < 7),
    reason: ({ labFindings }) =>
      `Hemoglobin ${labFindings.hemoglobin} g/dL is critically low (< 7).`,
    firstAid: [
      'Keep the patient at rest — even small exertion can cause collapse.',
      'Help them lie down with legs slightly raised if they feel faint.',
      'Offer small sips of water if conscious and able to swallow.',
    ],
    referral: REFERRAL_HEMOGLOBIN,
  },
  {
    key: 'wbc',
    label: 'White blood cell count',
    test: ({ labFindings }) =>
      labStatusIs(labFindings, 'wbc', (n) => n > 30000),
    reason: ({ labFindings }) =>
      `WBC ${labFindings.wbc} /µL is critically high (> 30,000).`,
    firstAid: [
      'Isolate the patient if a contagious infection is suspected.',
      'Monitor temperature and breathing pattern.',
      'Refer urgently — do not delay transport.',
    ],
    referral: REFERRAL_WBC,
  },
];

// --- Public API ------------------------------------------------------------
/**
 * Run the offline emergency rules engine.
 *
 * @param {object} input
 * @param {object} [input.vitals]      - { bp, heartRate, temperature, oxygen, glucose }
 * @param {string[]} [input.alerts]    - rule-based vitals alerts
 * @param {object} [input.labFindings] - parsed lab values from the document
 * @param {string[]} [input.labAlerts] - rule-based lab alerts
 * @returns {{
 *   triggered: boolean,
 *   severity: 'CRITICAL'|null,
 *   reasons: string[],
 *   firstAid: string[],
 *   referral: string,
 * }}
 */
export function evaluateEmergencyRules(input = {}) {
  const ctx = {
    vitals:
      input.vitals && typeof input.vitals === 'object' ? input.vitals : {},
    alerts: Array.isArray(input.alerts) ? input.alerts : [],
    labFindings:
      input.labFindings && typeof input.labFindings === 'object'
        ? input.labFindings
        : {},
    labAlerts: Array.isArray(input.labAlerts) ? input.labAlerts : [],
  };

  const reasons = [];
  const firstAidSet = new Set();
  let referral = '';

  RULES.forEach((rule) => {
    if (!rule.test(ctx)) return;
    const reason = rule.reason(ctx);
    if (reason) reasons.push(reason);
    rule.firstAid.forEach((step) => firstAidSet.add(step));
    if (rule.referral && !referral) referral = rule.referral;
  });

  const triggered = reasons.length > 0;

  return {
    triggered,
    severity: triggered ? 'CRITICAL' : null,
    reasons,
    firstAid: Array.from(firstAidSet),
    referral: triggered
      ? referral || REFERRAL_DEFAULT
      : '',
  };
}

/**
 * Convert an emergency override result into a TriageVerdict-shaped object
 * suitable for handing back to the UI when the AI is unavailable.
 *
 * Shape is compatible with the AI TriageResult components — the same
 * `verdict.severity`, `verdict.summary`, `verdict.possible_conditions`,
 * `verdict.recommended_actions`, and `verdict.referral` fields are used.
 *
 * @param {ReturnType<typeof evaluateEmergencyRules>} override
 * @returns {object} TriageVerdict
 */
export function emergencyOverrideToVerdict(override) {
  if (!override || !override.triggered) return null;
  return {
    severity: 'CRITICAL',
    confidence: 'high',
    summary:
      'EMERGENCY OVERRIDE — ' +
      (override.reasons[0] || 'critical findings detected') +
      (override.reasons.length > 1
        ? ` (+${override.reasons.length - 1} more)`
        : ''),
    possible_conditions: [
      'Life-threatening condition requiring immediate hospital evaluation.',
    ],
    recommended_actions: override.firstAid,
    referral: override.referral,
  };
}

export default evaluateEmergencyRules;
