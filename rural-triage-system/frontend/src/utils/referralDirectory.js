// Shuruksha Link — Smart Referral Directory (Step 23)
// --------------------------------------------------
// Deterministic, AI-independent referral planner. Turns the AI severity
// verdict (and the offline emergency override, if any) into a structured
// referral plan: facility type, urgency, transport, recommendation text,
// and a transfer checklist tailored to the case.
//
// Inputs:
//   severity         'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null
//   emergencyOverride { triggered, severity, reasons, firstAid, referral } | null
//   patientInfo      { name, age, gender, phone, address } | {}
//   vitals           { bp, heartRate, temperature, oxygen, glucose }
//   labFindings      { hemoglobin, wbc, platelet, ... }
//
// Output:
//   {
//     level:         'EMERGENCY' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW',
//     facilityType:  string,        // "District Hospital", "Home Observation", ...
//     urgency:       string,        // "Immediate" | "Urgent" | "Same-day" | "Within 48 hours" | "Routine"
//     transportation: string,        // "Emergency transport" | "Private vehicle" | "Not required"
//     recommendation: string,        // human-readable paragraph for the CHW
//     checklist:     string[],      // 4-7 actionable transfer items
//   }
//
// Design notes
// ------------
// - Pure: no side effects, no network, no AI. Safe to call on every render.
// - The Emergency Override ALWAYS wins. If `emergencyOverride.triggered`
//   is true, the function returns the EMERGENCY tier regardless of what
//   the AI severity says — this is the same precedence rule used by the
//   EmergencyOverrideCard and the offline-fallback verdict path.
// - Checklist items are pooled per tier, then trimmed so the list stays
//   scannable on a phone screen. The pediatric / geriatric modifiers
//   append age-specific items when the patient is under 5 or over 65.
// - Facility names use Bangladesh's rural health-system nomenclature
//   (Union Health Center, Upazila Health Complex, District Hospital,
//   Medical College Hospital) so the recommendations map to real
//   referral pathways the CHW already knows.

// --- Helpers ---------------------------------------------------------------
function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function patientAgeYears(patientInfo) {
  const n = num(patientInfo?.age);
  return n != null && n >= 0 && n <= 120 ? n : null;
}

function isPediatric(age) {
  return age != null && age < 5;
}
function isGeriatric(age) {
  return age != null && age >= 65;
}

function hasLabIssue(labFindings, key) {
  if (!labFindings || typeof labFindings !== 'object') return false;
  const raw = labFindings[key];
  if (raw === '' || raw == null) return false;
  return Number.isFinite(Number(raw));
}

// --- Tier templates --------------------------------------------------------
// Each tier returns the full ReferralPlan shape. The base lists are the
// always-on items; the modifier lists are appended conditionally.
const TIERS = {
  EMERGENCY: {
    level: 'EMERGENCY',
    facilityType: 'District Hospital / Medical College Hospital',
    urgency: 'Immediate',
    transportation: 'Emergency transport (ambulance)',
    recommendation:
      'Life-threatening findings detected. Activate emergency transport and transfer to the nearest District Hospital or Medical College Hospital without delay. Notify the receiving facility by phone before arrival.',
    baseChecklist: [
      'Call emergency transport / ambulance now',
      'Notify the receiving hospital by phone en route',
      'Bring the patient\'s previous prescriptions and lab reports',
      'Keep the airway open and monitor breathing continuously',
      'Document the time of symptom onset for the receiving clinician',
      'Ensure a family member or attendant accompanies the patient',
    ],
  },
  CRITICAL: {
    level: 'CRITICAL',
    facilityType: 'District Hospital',
    urgency: 'Immediate',
    transportation: 'Emergency transport (ambulance preferred)',
    recommendation:
      'Critical condition. Refer to the District Hospital for urgent physician evaluation. Arrange emergency transport and pre-notify the receiving facility.',
    baseChecklist: [
      'Arrange emergency transport (call ambulance if available)',
      'Pre-notify the receiving District Hospital by phone',
      'Bring previous prescriptions and any available lab reports',
      'Monitor airway, breathing, and circulation during transfer',
      'Keep the patient nil by mouth unless otherwise instructed',
      'Send a written referral note with vitals and brief history',
    ],
  },
  HIGH: {
    level: 'HIGH',
    facilityType: 'Upazila Health Complex',
    urgency: 'Same-day',
    transportation: 'Private vehicle / non-ambulance transport',
    recommendation:
      'Patient requires same-day evaluation at the Upazila Health Complex. Arrange prompt transport and bring all available clinical documents.',
    baseChecklist: [
      'Arrange transport to the Upazila Health Complex today',
      'Bring previous prescriptions and any lab reports',
      'Carry a written note with current vitals and chief complaint',
      'Advise the family to keep the patient upright / at rest during travel',
      'Confirm the patient\'s identity and contact details before departure',
    ],
  },
  MEDIUM: {
    level: 'MEDIUM',
    facilityType: 'Community Clinic / Union Health Center',
    urgency: 'Within 24-48 hours',
    transportation: 'Private vehicle',
    recommendation:
      'Stable but requires clinician review. Refer to the nearest Community Clinic or Union Health Center within the next 24-48 hours. Continue monitoring at home in the meantime.',
    baseChecklist: [
      'Visit the Community Clinic / Union Health Center within 48 hours',
      'Bring previous prescriptions and any recent lab reports',
      'Write down the symptom timeline for the clinician',
      'Continue prescribed home care and oral hydration if conscious',
      'Return immediately if symptoms worsen (breathing, consciousness, fever)',
    ],
  },
  LOW: {
    level: 'LOW',
    facilityType: 'Home Observation',
    urgency: 'Routine',
    transportation: 'Not required',
    recommendation:
      'Patient is stable. Provide home care and self-monitoring guidance. Return promptly if symptoms change or new warning signs appear.',
    baseChecklist: [
      'Rest at home and maintain adequate oral hydration',
      'Monitor temperature and symptoms twice daily for 3 days',
      'Keep a written log of medications taken and any side effects',
      'Return to the clinic if fever, breathing difficulty, or bleeding develops',
      'Follow up at the Community Clinic within one week for review',
    ],
  },
};

// --- Modifier pools --------------------------------------------------------
// Extra checklist items appended when a clinical modifier applies.
const MODIFIERS = {
  pediatric: [
    'Weigh the child and record the weight in the referral note',
    'Ask the caregiver to stay with the child throughout the transfer',
  ],
  geriatric: [
    'List the patient\'s chronic medications clearly in the referral note',
    'Check blood glucose and blood pressure again just before departure',
  ],
  abnormalVitals: [
    'Re-measure and record vitals (BP, pulse, SpO2, temperature) before transfer',
  ],
  labAbnormal: [
    'Bring the original lab report paper (or a clear photocopy) for the receiving doctor',
  ],
};

// --- Decision logic --------------------------------------------------------
/**
 * Compute a structured referral plan from triage inputs.
 *
 * Emergency Override always wins. Otherwise the tier is derived from
 * the AI severity (with a defensive floor at CRITICAL if the override
 * fired but didn't carry a flag — defensive only).
 *
 * @param {object} input
 * @param {string|null} [input.severity]        - 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
 * @param {object|null} [input.emergencyOverride]
 * @param {object}      [input.patientInfo]
 * @param {object}      [input.vitals]
 * @param {object}      [input.labFindings]
 * @returns {{
 *   level: string,
 *   facilityType: string,
 *   urgency: string,
 *   transportation: string,
 *   recommendation: string,
 *   checklist: string[],
 * }}
 */
export function getReferralRecommendation(input = {}) {
  const severity =
    typeof input.severity === 'string' ? input.severity.toUpperCase() : null;
  const emergencyOverride =
    input.emergencyOverride && typeof input.emergencyOverride === 'object'
      ? input.emergencyOverride
      : null;
  const patientInfo =
    input.patientInfo && typeof input.patientInfo === 'object'
      ? input.patientInfo
      : {};
  const vitals =
    input.vitals && typeof input.vitals === 'object' ? input.vitals : {};
  const labFindings =
    input.labFindings && typeof input.labFindings === 'object'
      ? input.labFindings
      : {};

  // 1. Emergency Override wins outright.
  if (emergencyOverride && emergencyOverride.triggered) {
    return buildPlan(TIERS.EMERGENCY, {
      patientInfo,
      vitals,
      labFindings,
    });
  }

  // 2. Otherwise map AI severity to a tier (default LOW when missing).
  const tier = (() => {
    switch (severity) {
      case 'CRITICAL':
        return TIERS.CRITICAL;
      case 'HIGH':
        return TIERS.HIGH;
      case 'MEDIUM':
        return TIERS.MEDIUM;
      case 'LOW':
      default:
        return TIERS.LOW;
    }
  })();

  return buildPlan(tier, { patientInfo, vitals, labFindings });
}

// --- Plan assembly ---------------------------------------------------------
function buildPlan(tier, { patientInfo, vitals, labFindings }) {
  const age = patientAgeYears(patientInfo);
  const checklist = [...tier.baseChecklist];

  // Pediatric (<5y) modifier
  if (isPediatric(age)) {
    checklist.push(...MODIFIERS.pediatric);
  }
  // Geriatric (>=65y) modifier
  if (isGeriatric(age)) {
    checklist.push(...MODIFIERS.geriatric);
  }

  // Vitals abnormalities (any out-of-range entry) → re-measure before transfer.
  const hasAnyVital =
    Object.values(vitals || {}).some(
      (v) => v !== '' && v != null && String(v).trim() !== ''
    );
  if (hasAnyVital) {
    checklist.push(MODIFIERS.abnormalVitals[0]);
  }

  // Lab findings present → bring the original report.
  const hasAnyLab = [
    'hemoglobin',
    'wbc',
    'platelet',
  ].some((k) => hasLabIssue(labFindings, k));
  if (hasAnyLab) {
    checklist.push(MODIFIERS.labAbnormal[0]);
  }

  // Deduplicate while preserving order (Set + Map trick).
  const seen = new Set();
  const uniqueChecklist = [];
  checklist.forEach((item) => {
    const key = String(item).trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    uniqueChecklist.push(item);
  });

  return {
    level: tier.level,
    facilityType: tier.facilityType,
    urgency: tier.urgency,
    transportation: tier.transportation,
    recommendation: tier.recommendation,
    checklist: uniqueChecklist,
  };
}

export default getReferralRecommendation;
