// Step 24.1 — minimal input should produce exactly 2 pages.
//
// The redesigned PDF deliberately uses a 2-page split (per the layout
// comment in generatePhysicianPdf.js):
//   Page 1: Header ▸ Severity ▸ Override ▸ Referral ▸ Patient ▸
//            Verdict ▸ Vitals ▸ Anomalies
//   Page 2: Lab ▸ Summary ▸ Conditions ▸ Actions ▸ First Aid ▸
//            Referral ▸ Voice ▸ OCR ▸ AI Disclaimer
// This guard catches regressions where the chunked mono block or
// the table refactors force a *third* (or later) page even for a
// minimal input.
import { generatePhysicianPdf } from './src/utils/generatePhysicianPdf.js';
import { writeFileSync } from 'node:fs';

const verdict = {
  severity: 'LOW',
  confidence: 'Medium',
  summary: 'Mild viral fever in young adult, no danger signs.',
  possible_conditions: ['Viral upper respiratory tract infection'],
  recommended_actions: ['Paracetamol for fever', 'Plenty of fluids', 'Rest'],
  referral: 'No referral needed at this time. Follow up if symptoms persist beyond 5 days.',
};

try {
  const result = generatePhysicianPdf({
    verdict,
    vitals: {
      'Blood Pressure': '118/76 mmHg',
      'Heart Rate': '88 bpm',
      'Temperature': '99.4 °F',
      'SpO2': '98%',
    },
    alerts: ['Low-grade fever'],
    voiceTranscript: 'Mild fever and body ache for two days.',
    ocrText: 'No known drug allergies. Otherwise healthy.',
    firstAid: ['Paracetamol 500mg every 6 hours', 'Drink warm fluids'],
    patientInfo: { 'Patient Name': 'Test User', Age: '28 years', Gender: 'Female' },
    emergencyOverride: null,
    referralPlan: null,
    __skipSave: true,
  });

  const doc = result.doc;
  if (!doc) {
    console.error('FAIL — no doc returned');
    process.exit(1);
  }
  const pdfBytes = doc.output('arraybuffer');
  writeFileSync(
    new URL('./repro-step24_1-small-output.pdf', import.meta.url),
    Buffer.from(pdfBytes)
  );

  const numPages = doc.internal.getNumberOfPages();
  console.log(`OK — small input produced ${numPages} page(s), ${pdfBytes.byteLength} bytes`);
  if (numPages !== 2) {
    console.error(`FAIL — expected exactly 2 pages for minimal input (per design split), got ${numPages}`);
    process.exit(1);
  }
  console.log('PASS — 2-page output confirmed (matches designed Page 1 / Page 2 split)');
} catch (err) {
  console.error('FAIL — generatePhysicianPdf threw:', err?.message);
  console.error(err?.stack);
  process.exit(1);
}
