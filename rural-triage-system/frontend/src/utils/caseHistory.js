// Shuruksha Link — Case history (audit trail) storage layer.
// Persists completed triage cases to browser LocalStorage so a CHW can
// review and reopen past visits during a session. Pure utility module —
// no React, no side effects beyond LocalStorage.

const STORAGE_KEY = 'shuruksha_link_case_history_v1';
export const MAX_CASES = 50;

// --- Defensive helpers ----------------------------------------------------
function safeParse(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    console.warn('[caseHistory] failed to parse stored history, resetting:', err);
    return null;
  }
}

function readAll() {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return safeParse(raw) || [];
}

function writeAll(list) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    console.error('[caseHistory] failed to write history:', err);
  }
}

// Stable, sortable id derived from timestamp + a short random suffix.
// We avoid `crypto.randomUUID` for older browsers; the suffix only needs
// to be unique within the visible list.
function makeId(timestamp) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${rand}`;
}

// Strip non-serializable values before writing. We never store Functions,
// Symbols, or DOM nodes, but be paranoid in case vitals is mutated to
// include a stray non-JSON value (e.g. undefined).
function sanitize(obj) {
  try {
    return JSON.parse(JSON.stringify(obj ?? null));
  } catch {
    return null;
  }
}

// --- Public API -----------------------------------------------------------
/**
 * Load the full list of saved cases, ordered newest first.
 * Always returns an array; never throws.
 */
export function loadHistory() {
  const list = readAll();
  // Sort defensively in case the stored order was corrupted.
  return [...list].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

/**
 * Persist a new triage case.
 * @param {object} input
 * @param {object} input.verdict          - TriageVerdict from the AI
 * @param {object} [input.vitals]         - Vitals object snapshot
 * @param {string[]} [input.alerts]       - Vitals-derived alerts snapshot
 * @param {string} [input.voiceText]      - Voice transcript snapshot
 * @param {string} [input.ocrText]        - OCR text snapshot
 * @param {object} [input.labFindings]    - Parsed lab values snapshot
 * @param {string[]} [input.labAlerts]    - Rule-based lab alerts snapshot
 * @param {object} [input.firstAid]       - Bilingual first-aid snapshot
 * @param {string} [input.outputLanguage] - 'en' | 'bn' snapshot
 * @param {object} [input.patientInfo]    - { name, age, gender, phone, address } patient demographics snapshot (Step 21)
 * @param {object} [input.emergencyOverride] - { triggered, severity, reasons, firstAid, referral } from the offline emergency rules engine (Step 22). Null when no critical trigger fires.
 * @param {object} [input.referralPlan] - { level, facilityType, urgency, transportation, recommendation, checklist } from the Smart Referral Directory (Step 23). Null until a triage request has produced a verdict.
 * @returns {object|null} The saved case (with id + timestamp), or null on failure.
 */
export function saveCase(input) {
  if (!input || !input.verdict) return null;
  const verdict = sanitize(input.verdict) || {};
  const timestamp = Date.now();
  const caseRecord = {
    id: makeId(timestamp),
    timestamp,
    severity: verdict.severity || 'LOW',
    confidence: verdict.confidence || 'low',
    summary: verdict.summary || '',
    possible_conditions: Array.isArray(verdict.possible_conditions)
      ? verdict.possible_conditions
      : [],
    recommended_actions: Array.isArray(verdict.recommended_actions)
      ? verdict.recommended_actions
      : [],
    referral: verdict.referral || '',
    vitals: sanitize(input.vitals) || {},
    alerts: Array.isArray(input.alerts) ? [...input.alerts] : [],
    voiceText: typeof input.voiceText === 'string' ? input.voiceText : '',
    ocrText: typeof input.ocrText === 'string' ? input.ocrText : '',
    labFindings: sanitize(input.labFindings) || {},
    labAlerts: Array.isArray(input.labAlerts) ? [...input.labAlerts] : [],
    // Bilingual first-aid snapshot — used by the PDF and by the reopened
    // case preview so the language and content stay locked to the case.
    firstAid: sanitize(input.firstAid) || null,
    // 'en' | 'bn' — drives the language picker on reopen so the user
    // sees the verdict + first-aid in the same script they typed it in.
    outputLanguage:
      input.outputLanguage === 'bn' || input.outputLanguage === 'bangla'
        ? 'bn'
        : 'en',
    // Step 21 — patient demographics captured at intake. Stored on the
    // case so reopen, PDF export, and audit logs all see the same person.
    patientInfo: sanitize(input.patientInfo) || {},
    // Step 22 — offline emergency rules result. Only non-null when the
    // engine fired (e.g. SpO2<90, HR>140, T>40, Glucose>400, etc.).
    // Used by the PDF generator to render the red callout block on
    // page 1 when this case is reopened and re-exported.
    emergencyOverride: sanitize(input.emergencyOverride) || null,
    // Step 23 — Smart Referral Directory snapshot. { level, facilityType,
    // urgency, transportation, recommendation, checklist }. Persisted so
    // the reopened case preview, the PDF re-export, and the audit trail
    // all see the exact same referral plan the CHW acted on.
    referralPlan: sanitize(input.referralPlan) || null,
  };

  const current = readAll();
  // Newest first; cap to MAX_CASES (oldest entries are dropped).
  const next = [caseRecord, ...current].slice(0, MAX_CASES);
  writeAll(next);
  return caseRecord;
}

/**
 * Delete a single case by id.
 * @param {string} id
 * @returns {boolean} true if a record was removed.
 */
export function deleteCase(id) {
  if (!id) return false;
  const current = readAll();
  const next = current.filter((c) => c && c.id !== id);
  if (next.length === current.length) return false;
  writeAll(next);
  return true;
}

/**
 * Wipe the entire history. Used by the "Clear all" button.
 */
export function clearAll() {
  writeAll([]);
}

/**
 * Helper for the UI — formatted "DD MMM YYYY · HH:mm" timestamp.
 */
export function formatTimestamp(ts) {
  if (!ts || !Number.isFinite(ts)) return 'Unknown date';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return 'Unknown date';
  const date = d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${date} · ${time}`;
}
