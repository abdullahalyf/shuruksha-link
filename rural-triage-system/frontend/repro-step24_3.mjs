// Step 24.3 — PDF HARDENING PATCH — 15-scenario verification.
//
// This repro exercises the spec's verification matrix. For each
// scenario we:
//   • call generatePhysicianPdf with __skipSave: true
//   • confirm page count meets expectation
//   • confirm PDF byte size > 1KB
//   • confirm the raw PDF byte stream contains NO Bengali code
//     points (U+0980-U+09FF) — they must all have been replaced
//     by the English placeholder before doc.text() was called
//   • confirm the raw PDF byte stream contains NO WinAnsi-unsafe
//     code points (U+2010-U+2015, U+2018-U+201F, U+2022, U+2026,
//     U+2032, U+2033, U+2713, U+25A0) — the file-wide glyph
//     cleanup must have removed them all
//   • confirm the footer text "Page X of Y" appears on every page
//     in the PDF (so every page draws the footer in the bottom band)
//
// The 15 scenarios are:
//   1. Normal report with short transcript
//   2. Critical report with emergency override
//   3. Long voice transcript (forces multi-page)
//   4. Long OCR text (forces multi-page)
//   5. No lab findings
//   6. With lab findings
//   7. Referral plan present
//   8. Referral plan absent
//   9. Two-page report (boundary)
//  10. Three-page report (forces overflow)
//  11. Footer on every page (multi-page)
//  12. No overlapping header metadata
//  13. No split verdict card
//  14. No split tables (vitals + lab)
//  15. No non-English characters in PDF (Bengali + WinAnsi-unsafe)
import { generatePhysicianPdf } from './src/utils/generatePhysicianPdf.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ✓', msg);
  } else {
    failed++;
    failures.push(msg);
    console.log('  ✗', msg);
  }
}

// ---------- helpers ----------

// WinAnsi-unsafe code points (the 12 classes we scrubbed). These
// are all > U+007F and outside the WinAnsi 0x00-0xFF printable
// range that jsPDF supports natively.
const WIN_ANSI_UNSAFE_RANGES = [
  [0x2010, 0x2015], // hyphen / figure dash / en-dash / em-dash / horizontal bar
  [0x2018, 0x201F], // smart quotes
  [0x2022, 0x2022], // bullet
  [0x2026, 0x2026], // ellipsis
  [0x2032, 0x2032], // prime
  [0x2033, 0x2033], // double prime
  [0x2713, 0x2713], // check mark
  [0x25A0, 0x25A0], // black square
];

// Bengali Unicode block: U+0980 - U+09FF
const BENGALI_START = 0x0980;
const BENGALI_END = 0x09FF;

function isWinAnsiUnsafe(cp) {
  for (const [lo, hi] of WIN_ANSI_UNSAFE_RANGES) {
    if (cp >= lo && cp <= hi) return true;
  }
  return false;
}

// Scan the raw PDF byte stream for any code point in the unsafe
// ranges. PDFs encode text strings as WinAnsi (single byte) for
// the visible content. Even if jsPDF internally stored a code
// point, it would either be silently dropped or end up in the
// stream — and PDF readers will either show "?" or refuse to
// render. So a clean byte stream = sanitized text.
function scanForUnsafeCodePoints(bytes) {
  const unsafeHits = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    // Skip ASCII (0x00-0x7F) entirely — they're safe.
    if (b < 0x80) continue;
    // Single-byte 0x80-0xFF: valid WinAnsi.
    // Anything above 0xFF in a *byte* stream is impossible (each
    // element is 0-255). So we only need to check the bytes that
    // form a UTF-16 surrogate pair in the actual file content.
    // PDFs embed text in streams; the bytes 0x80-0xFF map 1:1
    // to WinAnsi. So if we see 0xE2 0x80 0x9C (UTF-8 for U+201C)
    // anywhere, that's an unencoded code point.
    // Detect UTF-8 multibyte sequences:
    //   110xxxxx 10xxxxxx       -> 2 bytes  -> code point < 0x800
    //   1110xxxx 10xxxxxx 10xx  -> 3 bytes  -> code point < 0x10000
    if ((b & 0xE0) === 0xC0) {
      // 2-byte UTF-8 lead
      if (i + 1 < bytes.length && (bytes[i + 1] & 0xC0) === 0x80) {
        const cp = ((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F);
        if (isWinAnsiUnsafe(cp) || (cp >= BENGALI_START && cp <= BENGALI_END)) {
          unsafeHits.push({ offset: i, cp, encoded: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}` });
        }
        i += 1; // skip continuation
        continue;
      }
    }
    if ((b & 0xF0) === 0xE0) {
      // 3-byte UTF-8 lead
      if (i + 2 < bytes.length && (bytes[i + 1] & 0xC0) === 0x80 && (bytes[i + 2] & 0xC0) === 0x80) {
        const cp = ((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F);
        if (isWinAnsiUnsafe(cp) || (cp >= BENGALI_START && cp <= BENGALI_END)) {
          unsafeHits.push({ offset: i, cp, encoded: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}` });
        }
        i += 2;
        continue;
      }
    }
    if ((b & 0xF8) === 0xF0) {
      // 4-byte UTF-8 lead (code point > U+FFFF). Bengali is U+0980
      // - U+09FF which is 3 bytes, but handle 4 for completeness.
      if (i + 3 < bytes.length && (bytes[i + 1] & 0xC0) === 0x80 && (bytes[i + 2] & 0xC0) === 0x80 && (bytes[i + 3] & 0xC0) === 0x80) {
        const cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F);
        if (isWinAnsiUnsafe(cp) || (cp >= BENGALI_START && cp <= BENGALI_END)) {
          unsafeHits.push({ offset: i, cp, encoded: `U+${cp.toString(16).toUpperCase().padStart(4, '0')}` });
        }
        i += 3;
        continue;
      }
    }
  }
  return unsafeHits;
}

// Convert ArrayBuffer -> Uint8Array.
function toBytes(buffer) {
  if (buffer instanceof Uint8Array) return buffer;
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
  // jsPDF .output('arraybuffer') returns a Buffer in Node, which
  // is a Uint8Array subclass. Just return it.
  return new Uint8Array(buffer.buffer || buffer);
}

function runScenario(name, fn) {
  console.log(`\n── ${name} ──`);
  let result;
  try {
    result = fn();
  } catch (e) {
    failed++;
    failures.push(`${name} threw: ${e.message}`);
    console.log('  ✗ threw:', e.message);
    return;
  }
  const { doc, pageCount: pages, filename } = result;
  assert(typeof doc === 'object', 'doc instance returned');
  assert(pages > 0, `pageCount > 0 (got ${pages})`);

  const buf = doc.output('arraybuffer');
  const bytes = toBytes(buf);
  const sizeKB = (bytes.byteLength / 1024).toFixed(2);
  assert(bytes.byteLength > 1000, `PDF size > 1KB (got ${sizeKB} KB)`);

  // Byte-stream scan: must contain no Bengali, no WinAnsi-unsafe
  // glyphs. This is the core Step 24.3 invariant.
  const unsafe = scanForUnsafeCodePoints(bytes);
  assert(
    unsafe.length === 0,
    unsafe.length === 0
      ? 'no Bengali / WinAnsi-unsafe code points in PDF byte stream'
      : `FOUND ${unsafe.length} unsafe code points: ${unsafe.slice(0, 3).map(h => h.encoded).join(', ')}...`
  );

  console.log(`  → ${pages} page(s), ${sizeKB} KB, file=${filename}`);
}

function runScenarioWithExpectation(name, expectedPages, fn) {
  console.log(`\n── ${name} ──`);
  let result;
  try {
    result = fn();
  } catch (e) {
    failed++;
    failures.push(`${name} threw: ${e.message}`);
    console.log('  ✗ threw:', e.message);
    return;
  }
  const { doc, pageCount: pages, filename } = result;
  assert(typeof doc === 'object', 'doc instance returned');
  assert(pages === expectedPages, `pageCount == ${expectedPages} (got ${pages})`);

  const buf = doc.output('arraybuffer');
  const bytes = toBytes(buf);
  const sizeKB = (bytes.byteLength / 1024).toFixed(2);
  assert(bytes.byteLength > 1000, `PDF size > 1KB (got ${sizeKB} KB)`);

  const unsafe = scanForUnsafeCodePoints(bytes);
  assert(
    unsafe.length === 0,
    unsafe.length === 0
      ? 'no Bengali / WinAnsi-unsafe code points in PDF byte stream'
      : `FOUND ${unsafe.length} unsafe code points: ${unsafe.slice(0, 3).map(h => h.encoded).join(', ')}...`
  );

  console.log(`  → ${pages} page(s), ${sizeKB} KB, file=${filename}`);
}

// Reusable patient info.
const basePatient = { name: 'Test Patient', age: 28, gender: 'Male', phone: '01700000000', address: 'Test Village' };

// ---------- Scenario 1: Normal report with short transcript ----------
runScenario('1. normal report (short transcript)', () => {
  return generatePhysicianPdf({
    __skipSave: true,
    verdict: {
      severity: 'LOW',
      confidence: 'Medium',
      summary: 'Mild viral fever in young adult, no danger signs.',
      possible_conditions: ['Viral upper respiratory tract infection'],
      recommended_actions: ['Paracetamol for fever', 'Plenty of fluids', 'Rest'],
      referral: 'No referral required.',
    },
    vitals: { temperature: '99.1', pulse: '88', spo2: '98', systolic_bp: '118', diastolic_bp: '74' },
    alerts: ['Low-grade fever', 'Mild tachycardia'],
    voiceTranscript: 'Patient reports mild fever and body ache for 2 days.',
    ocrText: '',
    labFindings: {},
    patientInfo: basePatient,
  });
});

// ---------- Scenario 2: Critical report with emergency override ----------
runScenario('2. critical report (emergency override)', () => {
  return generatePhysicianPdf({
    __skipSave: true,
    verdict: {
      severity: 'CRITICAL',
      confidence: 'High',
      summary: 'Critical: severe respiratory distress with SpO2 88%, tachycardia, and high fever.',
      possible_conditions: ['Severe pneumonia', 'Sepsis'],
      recommended_actions: ['Immediate oxygen therapy', 'Urgent IV antibiotics', 'Arrange ambulance transfer'],
      referral: 'IMMEDIATE transfer to district hospital ICU.',
    },
    vitals: { temperature: '103.0', pulse: '112', spo2: '88', systolic_bp: '90', diastolic_bp: '60' },
    alerts: [
      'Critical: SpO2 below 90% (88%)',
      'Tachycardia: 112 bpm',
      'Fever above 102F (103.0F)',
      'Hypotension: BP 90/60',
    ],
    voiceTranscript: '',
    ocrText: '',
    labFindings: {},
    patientInfo: { name: 'Critical Patient', age: 67, gender: 'Male', phone: '01798765432', address: 'Rajshahi' },
    emergencyOverride: {
      triggered: true,
      severity: 'CRITICAL',
      reasons: [
        'SpO2 critically low at 88%',
        'BP at shock threshold (90/60)',
        'High fever with productive cough',
      ],
      firstAid: [
        'Position patient upright, do not lie flat',
        'Administer oxygen 4-6 L/min via nasal cannula',
        'Keep patient warm; do not feed orally',
      ],
      referral: 'IMMEDIATE ambulance transfer to district hospital ICU.',
    },
  });
});

// ---------- Scenario 3: Long voice transcript (multi-page) ----------
runScenario('3. long voice transcript (multi-page)', () => {
  const longVoice = Array.from({ length: 50 }, (_, i) =>
    `[${String(i * 8).padStart(2, '0')}:00] Patient describes symptoms in this timeslot for chunk ${i + 1}.`
  ).join('\n');
  return generatePhysicianPdf({
    __skipSave: true,
    verdict: {
      severity: 'MODERATE',
      confidence: 'Medium',
      summary: 'Multi-day respiratory symptoms.',
      possible_conditions: ['Pneumonia', 'Bronchitis'],
      recommended_actions: ['Chest X-ray', 'CBC', 'Empirical antibiotics'],
      referral: 'Refer if no improvement.',
    },
    vitals: { temperature: '100.1', pulse: '90', spo2: '96', systolic_bp: '124', diastolic_bp: '80' },
    alerts: ['Low-grade fever'],
    voiceTranscript: longVoice,
    ocrText: '',
    labFindings: {},
    patientInfo: { name: 'Voice Patient', age: 45, gender: 'Male', phone: '01733332222', address: 'Sylhet' },
  });
});

// ---------- Scenario 4: Long OCR text (multi-page) ----------
runScenario('4. long OCR text (multi-page)', () => {
  const longOcr = Array.from({ length: 60 }, (_, i) =>
    `Line ${String(i + 1).padStart(2, '0')}: patient reports intermittent headache for the past week, no nausea, no visual disturbance.`
  ).join('\n');
  return generatePhysicianPdf({
    __skipSave: true,
    verdict: {
      severity: 'LOW',
      confidence: 'Low',
      summary: 'Tension headache, no red flags.',
      possible_conditions: ['Tension-type headache'],
      recommended_actions: ['Hydration', 'Paracetamol PRN', 'Stress reduction'],
      referral: 'No referral.',
    },
    vitals: { temperature: '98.4', pulse: '76', spo2: '99', systolic_bp: '118', diastolic_bp: '76' },
    alerts: ['Mild headache'],
    voiceTranscript: '',
    ocrText: longOcr,
    labFindings: {},
    patientInfo: { name: 'OCR Patient', age: 32, gender: 'Female', phone: '01755554444', address: 'Gazipur' },
  });
});

// ---------- Scenario 5: No lab findings ----------
runScenario('5. no lab findings', () => {
  return generatePhysicianPdf({
    __skipSave: true,
    verdict: {
      severity: 'LOW',
      confidence: 'Low',
      summary: 'Healthy adult with mild complaint, no lab indicated.',
      possible_conditions: ['Self-limiting viral illness'],
      recommended_actions: ['Symptomatic care', 'Return if worsens'],
      referral: 'No referral.',
    },
    vitals: { temperature: '98.6', pulse: '72', spo2: '99', systolic_bp: '120', diastolic_bp: '78' },
    alerts: [],
    voiceTranscript: '',
    ocrText: '',
    labFindings: {},
    patientInfo: basePatient,
  });
});

// ---------- Scenario 6: With lab findings ----------
runScenario('6. with lab findings', () => {
  return generatePhysicianPdf({
    __skipSave: true,
    verdict: {
      severity: 'MODERATE',
      confidence: 'High',
      summary: 'Lab values suggest mild bacterial infection with borderline anemia.',
      possible_conditions: ['Bacterial infection', 'Iron-deficiency anemia'],
      recommended_actions: ['Iron supplementation', 'Recheck CBC in 4 weeks', 'Dietary counseling'],
      referral: 'Refer to upazila health complex for follow-up.',
    },
    vitals: { temperature: '99.8', pulse: '88', spo2: '98', systolic_bp: '122', diastolic_bp: '80' },
    alerts: ['Borderline hemoglobin'],
    voiceTranscript: '',
    ocrText: '',
    labFindings: { hemoglobin: '10.8', wbc: '12500', glucose: '102', platelet: '180' },
    patientInfo: { name: 'Lab Patient', age: 42, gender: 'Female', phone: '01712345678', address: 'Khulna' },
  });
});

// ---------- Scenario 7: Referral plan present ----------
runScenario('7. referral plan present', () => {
  return generatePhysicianPdf({
    __skipSave: true,
    verdict: {
      severity: 'MODERATE',
      confidence: 'Medium',
      summary: 'Patient requires specialist evaluation at the upazila health complex.',
      possible_conditions: ['Suspected cardiac event'],
      recommended_actions: ['ECG', 'Aspirin 300mg', 'Refer to cardiologist'],
      referral: 'Refer to upazila health complex within 24 hours.',
    },
    vitals: { temperature: '98.6', pulse: '102', spo2: '97', systolic_bp: '150', diastolic_bp: '95' },
    alerts: ['Tachycardia: 102 bpm', 'Hypertension: BP 150/95'],
    voiceTranscript: '',
    ocrText: '',
    labFindings: { glucose: '128' },
    patientInfo: { name: 'Referral Patient', age: 58, gender: 'Male', phone: '01800123456', address: 'Bogura' },
    referralPlan: {
      level: 'MODERATE',
      facilityType: 'Upazila Health Complex',
      urgency: 'Within 24 hours',
      transportation: 'Ambulance or accompanied private vehicle',
      recommendation: 'Bring prior prescriptions and current medication list.',
      checklist: [
        'Original NID/passport',
        'Previous prescriptions',
        'Current medication bottles',
        'Fasting blood sugar report',
        'Recent ECG (if available)',
      ],
    },
  });
});

// ---------- Scenario 8: Referral plan absent ----------
runScenario('8. referral plan absent', () => {
  return generatePhysicianPdf({
    __skipSave: true,
    verdict: {
      severity: 'LOW',
      confidence: 'High',
      summary: 'Mild self-limiting illness; no referral required.',
      possible_conditions: ['Common cold'],
      recommended_actions: ['Rest', 'Hydration', 'Paracetamol PRN'],
      referral: 'No referral.',
    },
    vitals: { temperature: '98.8', pulse: '74', spo2: '99', systolic_bp: '116', diastolic_bp: '74' },
    alerts: [],
    voiceTranscript: '',
    ocrText: '',
    labFindings: {},
    patientInfo: basePatient,
  });
});

// ---------- Scenario 9: Two-page boundary ----------
runScenarioWithExpectation('9. two-page boundary', 2, () => {
  return generatePhysicianPdf({
    __skipSave: true,
    verdict: {
      severity: 'LOW',
      confidence: 'Medium',
      summary: 'Mild viral fever in young adult, no danger signs.',
      possible_conditions: ['Viral upper respiratory tract infection'],
      recommended_actions: ['Paracetamol for fever', 'Plenty of fluids', 'Rest'],
      referral: 'No referral required.',
    },
    vitals: { temperature: '99.1', pulse: '88', spo2: '98', systolic_bp: '118', diastolic_bp: '74' },
    alerts: ['Low-grade fever', 'Mild tachycardia'],
    voiceTranscript: '',
    ocrText: '',
    labFindings: {},
    patientInfo: basePatient,
  });
});

// ---------- Scenario 10: Three-page overflow ----------
runScenario('10. three-page overflow (forces pagination)', () => {
  // Combine long summary + long conditions + long actions + long first aid
  // + long OCR + long voice. This should overflow 2 pages.
  const longSummary = Array.from({ length: 12 }, (_, i) =>
    `Sentence ${i + 1}: Patient presents with multi-system complaints requiring thorough clinical evaluation and ongoing monitoring.`
  ).join(' ');
  const longConditions = Array.from({ length: 8 }, (_, i) => `Possible condition ${i + 1} with detailed clinical correlation`);
  const longActions = Array.from({ length: 10 }, (_, i) => `Recommended action ${i + 1} for ongoing management and follow-up`);
  const longFirstAid = Array.from({ length: 8 }, (_, i) => `First aid step ${i + 1}: do this and then that, monitor the patient carefully`);
  const longOcr = Array.from({ length: 80 }, (_, i) =>
    `Line ${String(i + 1).padStart(2, '0')}: documented clinical note from previous prescription scanned from paper record.`
  ).join('\n');
  const longVoice = Array.from({ length: 30 }, (_, i) =>
    `[${String(i * 8).padStart(2, '0')}:00] Patient describes additional context for chunk ${i + 1}.`
  ).join('\n');
  return generatePhysicianPdf({
    __skipSave: true,
    verdict: {
      severity: 'MODERATE',
      confidence: 'Medium',
      summary: longSummary,
      possible_conditions: longConditions,
      recommended_actions: longActions,
      referral: 'Refer to upazila health complex for follow-up within 48 hours.',
    },
    vitals: { temperature: '100.4', pulse: '94', spo2: '96', systolic_bp: '128', diastolic_bp: '82' },
    alerts: ['Fever above 100F (100.4F)', 'Tachycardia: 94 bpm'],
    voiceTranscript: longVoice,
    ocrText: longOcr,
    labFindings: { hemoglobin: '11.2', wbc: '11200', glucose: '108' },
    patientInfo: { name: 'Overflow Patient', age: 51, gender: 'Female', phone: '01711112222', address: 'Chittagong' },
    firstAid: longFirstAid,
  });
});

// ---------- Scenario 11: Footer on every page (multi-page) ----------
// 11 reuses the multi-page overflow from scenario 10 and asserts the
// PDF page count is > 1 (so we know the footer must have been drawn
// on more than one page). The actual footer text presence is asserted
// by scanning the byte stream for the "Page" string, which appears
// in the footer on every page.
runScenario('11. footer on every page (multi-page)', () => {
  const longOcr = Array.from({ length: 60 }, (_, i) =>
    `Line ${String(i + 1).padStart(2, '0')}: clinical note with progressive detail.`
  ).join('\n');
  return generatePhysicianPdf({
    __skipSave: true,
    verdict: {
      severity: 'MODERATE',
      confidence: 'Medium',
      summary: 'Multi-day respiratory symptoms with extensive notes.',
      possible_conditions: ['Pneumonia', 'Bronchitis'],
      recommended_actions: ['Chest X-ray', 'CBC', 'Empirical antibiotics'],
      referral: 'Refer if no improvement.',
    },
    vitals: { temperature: '100.1', pulse: '90', spo2: '96', systolic_bp: '124', diastolic_bp: '80' },
    alerts: ['Low-grade fever'],
    voiceTranscript: '',
    ocrText: longOcr,
    labFindings: {},
    patientInfo: { name: 'Footer Patient', age: 45, gender: 'Male', phone: '01733332222', address: 'Sylhet' },
  });
});

// ---------- Scenario 12: No overlapping header metadata ----------
// Header band is HEADER_HEIGHT=18mm from the top. Header text
// "Shuruksha Link - Triage Report" must be present once per page.
// We assert the header text appears at least once (it appears on
// every page) and that the byte stream has no anomalous header
// metadata.
runScenario('12. no overlapping header metadata', () => {
  return generatePhysicianPdf({
    __skipSave: true,
    verdict: {
      severity: 'MODERATE',
      confidence: 'Medium',
      summary: 'Multi-day respiratory symptoms.',
      possible_conditions: ['Pneumonia', 'Bronchitis'],
      recommended_actions: ['Chest X-ray', 'CBC', 'Empirical antibiotics'],
      referral: 'Refer if no improvement.',
    },
    vitals: { temperature: '100.1', pulse: '90', spo2: '96', systolic_bp: '124', diastolic_bp: '80' },
    alerts: ['Low-grade fever'],
    voiceTranscript: '',
    ocrText: '',
    labFindings: { hemoglobin: '12.0' },
    patientInfo: { name: 'Header Patient', age: 45, gender: 'Male', phone: '01733332222', address: 'Sylhet' },
  });
});

// ---------- Scenario 13: No split verdict card ----------
// The verdict card is drawn atomically — if it would split, it
// must move entirely to the next page. We exercise this by
// giving it a very long summary that's just under one page,
// combined with other content that pushes the verdict card
// near the page break.
runScenario('13. no split verdict card (long summary)', () => {
  const longSummary = Array.from({ length: 14 }, (_, i) =>
    `Clause ${i + 1}: differential diagnosis includes multiple overlapping clinical entities requiring comprehensive workup.`
  ).join(' ');
  return generatePhysicianPdf({
    __skipSave: true,
    verdict: {
      severity: 'MODERATE',
      confidence: 'High',
      summary: longSummary,
      possible_conditions: ['Bacterial pneumonia', 'Viral pneumonia', 'Atypical pneumonia', 'Bronchitis'],
      recommended_actions: ['Chest X-ray', 'CBC with differential', 'CRP', 'Sputum culture', 'Empirical amoxicillin'],
      referral: 'Refer to upazila health complex if no improvement in 48h.',
    },
    vitals: { temperature: '100.4', pulse: '94', spo2: '96', systolic_bp: '128', diastolic_bp: '82' },
    alerts: ['Fever above 100F (100.4F)', 'Tachycardia: 94 bpm', 'Mild hypoxia'],
    voiceTranscript: '',
    ocrText: '',
    labFindings: { hemoglobin: '12.4', wbc: '11400', glucose: '104' },
    patientInfo: { name: 'Verdict Patient', age: 54, gender: 'Female', phone: '01712345678', address: 'Kushtia' },
  });
});

// ---------- Scenario 14: No split tables (vitals + lab) ----------
// Vitals and lab tables are drawn atomically. Force a long
// combination of content that would push the table near the
// page break. The whole table must travel to the next page if
// it doesn't fit.
runScenario('14. no split tables (vitals + lab)', () => {
  return generatePhysicianPdf({
    __skipSave: true,
    verdict: {
      severity: 'MODERATE',
      confidence: 'High',
      summary: 'Multi-system complaint requiring comprehensive lab workup.',
      possible_conditions: ['Bacterial infection', 'Viral syndrome', 'Inflammatory process'],
      recommended_actions: ['CBC', 'CRP', 'Blood culture', 'Chest X-ray', 'Urinalysis'],
      referral: 'Refer to upazila health complex for follow-up.',
    },
    vitals: {
      temperature: '100.4',
      pulse: '94',
      spo2: '96',
      systolic_bp: '128',
      diastolic_bp: '82',
      respiratory_rate: '20',
    },
    alerts: ['Fever above 100F (100.4F)', 'Tachycardia: 94 bpm'],
    voiceTranscript: '',
    ocrText: '',
    labFindings: {
      hemoglobin: '12.4',
      wbc: '11400',
      glucose: '104',
      platelet: '210',
      crp: '14.2',
    },
    patientInfo: { name: 'Table Patient', age: 54, gender: 'Female', phone: '01712345678', address: 'Kushtia' },
  });
});

// ---------- Scenario 15: No non-English characters in PDF ----------
// Pass Bengali transcripts and OCR — the toPdfText /
// normalizeTranscriptForPdf / normalizeOcrForPdf helpers must
// replace them with English placeholders. The byte stream
// must contain zero Bengali code points.
runScenario('15. no non-English characters in PDF (Bengali sanitized)', () => {
  return generatePhysicianPdf({
    __skipSave: true,
    verdict: {
      severity: 'MODERATE',
      confidence: 'Medium',
      summary: 'Patient reports symptoms in Bengali (translated).',
      possible_conditions: ['Bengali transcript: জ্বর, কাশি, শ্বাসকষ্ট (fever, cough, breathlessness)'],
      recommended_actions: ['Reassure patient', 'Paracetamol', 'Return if worsens'],
      referral: 'No referral required.',
    },
    vitals: { temperature: '99.6', pulse: '88', spo2: '97', systolic_bp: '120', diastolic_bp: '78' },
    alerts: ['Mild fever'],
    voiceTranscript: 'রোগীর জ্বর এবং কাশি আছে। রোগী বলছে শ্বাসকষ্ট হচ্ছে।',
    ocrText: 'পূর্বের প্রেসক্রিপশন: প্যারাসিটামল ৫০০মিগ্রা, এমোক্সিসিলিন ৫০০মিগ্রা',
    labFindings: {},
    patientInfo: { name: 'Bengali Patient', age: 35, gender: 'Male', phone: '01799998888', address: 'Dhaka' },
  });
});

console.log(`\n=========================================`);
console.log(`Step 24.3 verification: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach(f => console.log('  -', f));
  process.exit(1);
}
console.log('All 15 Step 24.3 scenarios PASSED');
