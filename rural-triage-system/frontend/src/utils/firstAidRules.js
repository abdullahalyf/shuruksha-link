// Shuruksha Link — Deterministic First-Aid Knowledge Base
// -----------------------------------------------------------------
// Pure, side-effect-free rule engine. Produces a short list of
// safe, generic first-aid actions for the CHW to start while the
// AI verdict is being generated (or instead of it, on a Gemini
// outage). Runs entirely on the client. No network, no AI.
//
// Inputs:
//   vitals      { bp, heartRate, temperature, oxygen, glucose }
//   labAlerts   string[]  (rule-based messages from parseMedicalReport)
//   alerts      string[]  (rule-based vitals alerts from checkVitals)
//
// Output:
//   { firstAidTitle, firstAidItems: [{ en, bn }] }
//
// Design notes
// ------------
// - The same shape is used in both English and Bengali so the UI
//   can pick the language at render time without re-deriving.
// - Order is stable and clinical-priority: airway / breathing /
//   circulation first, then the highest risk vitals, then labs.
// - We never re-state the red-flag emergency here — that banner
//   already covers "refer to hospital immediately". First-aid
//   focuses on what the CHW can DO in the next 10 minutes.
// - Each rule fires independently. We don't dedupe across rules
//   because the CHW is going to scan the list quickly; explicit
//   repetition is fine.

const TITLE = {
  en: 'First Aid Recommendations',
  bn: 'প্রাথমিক চিকিৎসা পরামর্শ',
};

// --- Helpers ---------------------------------------------------------------
function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseBp(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
  if (!m) return null;
  const systolic = Number(m[1]);
  const diastolic = Number(m[2]);
  if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) return null;
  return { systolic, diastolic };
}

function hasLabAlert(labAlerts, pattern) {
  if (!Array.isArray(labAlerts)) return false;
  return labAlerts.some((a) => pattern.test(a));
}

// --- Rule table -----------------------------------------------------------
// Each rule returns an array of { en, bn } items, or [] when not triggered.
// Rules are intentionally short and conservative. They never say "give
// medication" or "diagnose X" — only positioning, monitoring, hydration,
// and "refer if worsens".
const RULES = [
  // SpO2 < 95 — keep upright, monitor breathing, refer if worsens.
  {
    key: 'low_spo2',
    test: ({ vitals }) => {
      const s = num(vitals?.oxygen);
      return s != null && s < 95;
    },
    items: [
      {
        en: 'Keep patient sitting upright; do not lay flat',
        bn: 'রোগীকে সোজা হয়ে বসিয়ে রাখুন; শুইয়ে দেবেন না',
      },
      {
        en: 'Monitor breathing continuously',
        bn: 'শ্বাস-প্রশ্বাস ক্রমাগত পর্যবেক্ষণ করুন',
      },
      {
        en: 'Refer if symptoms worsen',
        bn: 'উপসর্গ বাড়লে হাসপাতালে পাঠান',
      },
    ],
  },

  // Temp > 38 (high fever) — encourage fluids, monitor temp, refer if persists.
  {
    key: 'high_fever',
    test: ({ vitals }) => {
      const t = num(vitals?.temperature);
      return t != null && t > 38;
    },
    items: [
      {
        en: 'Encourage oral fluids',
        bn: 'মুখে প্রচুর পানি / তরল খাওয়ান',
      },
      {
        en: 'Monitor temperature every 30 minutes',
        bn: 'প্রতি ৩০ মিনিটে জ্বর মাপুন',
      },
      {
        en: 'Refer if fever persists beyond 24 hours',
        bn: '২৪ ঘণ্টার বেশি জ্বর থাকলে হাসপাতালে পাঠান',
      },
    ],
  },

  // Temp >= 40 (very high fever) — escalation tier.
  {
    key: 'very_high_fever',
    test: ({ vitals }) => {
      const t = num(vitals?.temperature);
      return t != null && t >= 40;
    },
    items: [
      {
        en: 'Seek immediate medical evaluation',
        bn: 'অবিলম্বে চিকিৎসকের কাছে নিয়ে যান',
      },
      {
        en: 'Cool patient safely (tepid sponging, light clothing)',
        bn: 'কুসুম গরম পানি দিয়ে শরীর মুছে দিন, হালকা পোশাক রাখুন',
      },
      {
        en: 'Monitor level of consciousness',
        bn: 'রোগীর জ্ঞানের অবস্থা পর্যবেক্ষণ করুন',
      },
    ],
  },

  // Glucose > 180 (high) — hydration, monitor, evaluate.
  {
    key: 'high_glucose',
    test: ({ vitals }) => {
      const g = num(vitals?.glucose);
      return g != null && g > 180;
    },
    items: [
      {
        en: 'Encourage hydration if patient is conscious',
        bn: 'রোগীর জ্ঞান থাকলে প্রচুর পানি পান করান',
      },
      {
        en: 'Monitor blood sugar every 1–2 hours',
        bn: 'প্রতি ১–২ ঘণ্টায় রক্তে শর্করা পরীক্ষা করুন',
      },
      {
        en: 'Seek medical evaluation',
        bn: 'চিকিৎসকের পরামর্শ নিন',
      },
    ],
  },

  // Glucose > 300 (very high) — escalation tier, watch mental status.
  {
    key: 'very_high_glucose',
    test: ({ vitals }) => {
      const g = num(vitals?.glucose);
      return g != null && g > 300;
    },
    items: [
      {
        en: 'Refer to facility immediately',
        bn: 'অবিলম্বে স্বাস্থ্য কমপ্লেক্সে পাঠান',
      },
      {
        en: 'Monitor mental status and breathing pattern',
        bn: 'রোগীর জ্ঞান ও শ্বাস-প্রশ্বাসের ধরন পর্যবেক্ষণ করুন',
      },
      {
        en: 'Watch for dehydration (dry mouth, sunken eyes, low urine)',
        bn: 'পানিশূন্যতার লক্ষণ (শুকনো মুখ, চোখ গর্তে, কম প্রস্রাব) দেখুন',
      },
    ],
  },

  // Heart Rate > 100 (tachycardia) — rest, monitor, evaluate cause.
  {
    key: 'tachycardia',
    test: ({ vitals }) => {
      const hr = num(vitals?.heartRate);
      return hr != null && hr > 100;
    },
    items: [
      {
        en: 'Rest the patient in a cool, quiet place',
        bn: 'রোগীকে শান্ত ও ঠাণ্ডা জায়গায় বিশ্রামে রাখুন',
      },
      {
        en: 'Monitor pulse every 15 minutes',
        bn: 'প্রতি ১৫ মিনিটে নাড়ি পরীক্ষা করুন',
      },
      {
        en: 'Evaluate underlying cause (fever, dehydration, pain)',
        bn: 'কারণ নির্ণয় করুন (জ্বর, পানিশূন্যতা, ব্যথা)',
      },
    ],
  },

  // Platelet low / thrombocytopenia — avoid trauma, watch for bleeding.
  {
    key: 'thrombocytopenia',
    test: ({ labAlerts }) =>
      hasLabAlert(
        labAlerts,
        /THROMBOCYTOPENIA|LOW\s+PLATELET|PLATELET/i
      ),
    items: [
      {
        en: 'Avoid trauma, injections, and IM medications if possible',
        bn: 'আঘাত, ইনজেকশন ও মাংসপেশিতে ওষুধ এড়িয়ে চলুন',
      },
      {
        en: 'Watch for bleeding (gums, skin petechiae, urine, stool)',
        bn: 'রক্তপাতের লক্ষণ দেখুন (মাড়ি, ত্বকের দাগ, প্রস্রাব, পায়খানা)',
      },
      {
        en: 'Refer for physician review',
        bn: 'চিকিৎসকের কাছে পাঠান',
      },
    ],
  },

  // Hemoglobin < 7 (severe anemia) — immediate evaluation, monitor.
  {
    key: 'severe_anemia',
    test: ({ labAlerts, vitals }) => {
      if (hasLabAlert(labAlerts, /SEVERE\s+ANEMIA|CRITICAL\s+ANEMIA|HEMOGLOBIN.*<\s*7|HB\s*<\s*7/i)) {
        return true;
      }
      // Fallback: raw vitals doesn't carry Hb, but the OCR parser does.
      return false;
    },
    items: [
      {
        en: 'Arrange immediate physician evaluation',
        bn: 'অবিলম্বে চিকিৎসকের মূল্যায়নের ব্যবস্থা করুন',
      },
      {
        en: 'Monitor symptoms closely (fatigue, pallor, breathlessness)',
        bn: 'লক্ষণগুলো নিবিড়ভাবে পর্যবেক্ষণ করুন (ক্লান্তি, ফ্যাকাসে, শ্বাসকষ্ট)',
      },
    ],
  },
];

// --- Public API -----------------------------------------------------------
/**
 * Generate a deterministic first-aid list for the current intake.
 *
 * @param {object} input
 * @param {object} [input.vitals]     { bp, heartRate, temperature, oxygen, glucose }
 * @param {string[]} [input.alerts]   vitals-derived alerts
 * @param {string[]} [input.labAlerts] OCR-derived lab alerts
 * @param {string} [input.language]   'en' | 'bn' — language hint for logging only;
 *                                    output is always bilingual and selected at render
 * @returns {{ firstAidTitle: { en: string, bn: string }, firstAidItems: Array<{ en: string, bn: string }> }}
 */
export function generateFirstAid({ vitals = {}, alerts = [], labAlerts = [], language } = {}) {
  const items = [];
  const triggered = [];

  for (const rule of RULES) {
    try {
      if (rule.test({ vitals, alerts, labAlerts })) {
        items.push(...rule.items);
        triggered.push(rule.key);
      }
    } catch {
      // Defensive: a malformed rule must never break the UI.
    }
  }

  if (language === 'bn' || language === 'en') {
    // Log triggered rules in dev for observability — doesn't affect output.
    if (typeof console !== 'undefined' && triggered.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[firstAid] language=${language} rules=${triggered.join(',')}`);
    }
  }

  return {
    firstAidTitle: { ...TITLE },
    firstAidItems: items,
  };
}

// Export the rule keys + title map for tests / devtools inspection.
export const FIRST_AID_RULES = RULES.map((r) => r.key);
export const FIRST_AID_TITLE = TITLE;

export default generateFirstAid;
