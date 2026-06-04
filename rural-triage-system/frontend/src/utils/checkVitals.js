// Vitals threshold rules.
// Adult resting values, taken from common clinical reference ranges.
// BP is intentionally not flagged here — the PRD only specifies the
// four numeric thresholds listed below.

export const VITALS_RULES = [
  {
    key: 'heartRate',
    label: 'Heart Rate',
    test: (v) => v != null && v !== '' && (Number(v) < 60 || Number(v) > 100),
    message: (v) =>
      `Heart Rate ${v} bpm is outside the safe range (60–100 bpm).`,
  },
  {
    key: 'temperature',
    label: 'Temperature',
    test: (v) => v != null && v !== '' && Number(v) > 38,
    message: (v) => `Temperature ${v}°C is high (fever threshold > 38°C).`,
  },
  {
    key: 'oxygen',
    label: 'SpO2',
    test: (v) => v != null && v !== '' && Number(v) < 95,
    message: (v) => `SpO2 ${v}% is low (safe range ≥ 95%).`,
  },
  {
    key: 'glucose',
    label: 'Blood Glucose',
    test: (v) => v != null && v !== '' && Number(v) > 180,
    message: (v) =>
      `Blood Glucose ${v} mg/dL is high (safe range ≤ 180 mg/dL).`,
  },
];

/**
 * Evaluate a vitals object and return an array of human-readable alert strings.
 * @param {{ heartRate: string|number, temperature: string|number, oxygen: string|number, glucose: string|number }} vitals
 * @returns {string[]} alerts
 */
export function checkVitals(vitals) {
  const alerts = [];
  for (const rule of VITALS_RULES) {
    const value = vitals[rule.key];
    if (rule.test(value)) {
      alerts.push(rule.message(value));
    }
  }
  return alerts;
}
