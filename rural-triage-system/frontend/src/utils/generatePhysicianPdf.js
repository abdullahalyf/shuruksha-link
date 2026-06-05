// Shuruksha Link — Physician PDF report generator
// Pure utility that turns the assembled triage payload into a print-ready
// A4 clinical report using jsPDF. Designed to be called from TriageResult.
//
// Layout (hospital letterhead style, English only):
//   Header  — Project name, report title, generated timestamp, report ID
//             separated by thin double rules (no colored band).
//   Page 1  — Severity banner (the only colored block), Clinical Summary,
//             Patient Vitals table (Parameter | Value | Status),
//             Anomaly Findings.
//   Page 2+ — Possible Conditions, Recommended Actions, Referral
//             Recommendation, Voice Transcript, OCR Extracted Text.
//   Footer  — Project name, confidentiality notice, page number on every
//             page, and a final AI disclaimer rule.
//
// Typography:
//   Document title  : Helvetica-Bold 20pt
//   H2 section caps : Helvetica-Bold 10pt with 1pt letter-spacing
//   Body text       : Helvetica 10pt
//   Labels / values : Helvetica-Bold 10pt
//   Monospace       : Courier 9pt  (voice transcript, OCR text)
//   Footnote / meta : Helvetica 8pt
//
// Color usage: deliberately minimal. The only colored block is the
// severity banner, and the only colored glyphs are the Status pills in
// the vitals table. Everything else is black/grey for a print-friendly
// clinical look.

import { jsPDF } from 'jspdf';

// --- A4 geometry ---------------------------------------------------------
const PAGE_W = 210; // mm
const PAGE_H = 297; // mm
const MARGIN_X = 18;
const MARGIN_TOP = 22;
const MARGIN_BOTTOM = 20;
const CONTENT_W = PAGE_W - MARGIN_X * 2; // 174 mm

// --- Color tokens (print-friendly, used sparingly) -----------------------
const COLOR = {
  ink:        [17, 24, 39],   // slate-900 — body text
  inkMuted:   [71, 85, 105],  // slate-600 — labels, meta
  inkFaint:   [148, 163, 184], // slate-400 — rules, axis labels
  rule:       [203, 213, 225], // slate-300 — table rules
  ruleStrong: [100, 116, 139], // slate-500 — emphasis rules
  bg:         [255, 255, 255], // white
  // Severity palette (used only on banner + status pill)
  low:        [16, 185, 129],  // emerald-500
  medium:     [217, 119, 6],   // amber-600 (slightly darker for print)
  high:       [220, 38, 38],   // red-600
  critical:   [159, 18, 57],   // rose-800
};

// Severity visual mapping — kept in sync with TriageResult's SEVERITY_META.
const SEVERITY_PALETTE = {
  LOW:      { label: 'LOW',      rgb: COLOR.low,      rank: 1, word: 'Stable' },
  MEDIUM:   { label: 'MEDIUM',   rgb: COLOR.medium,   rank: 2, word: 'Caution' },
  HIGH:     { label: 'HIGH',     rgb: COLOR.high,     rank: 3, word: 'Urgent' },
  CRITICAL: { label: 'CRITICAL', rgb: COLOR.critical, rank: 4, word: 'Emergency' },
};

// --- Vitals field metadata (must match VitalsForm.jsx) -------------------
// Normal ranges are inclusive of low and exclusive of high. Each range
// returns a status that the vitals table renders as a colored pill.
const VITAL_FIELDS = [
  { key: 'bp',         label: 'Blood Pressure',     unit: 'mmHg',  normal: (v) => {
      const m = String(v).match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
      if (!m) return { status: 'UNKNOWN', text: '—' };
      const sys = +m[1], dia = +m[2];
      if (sys < 90 || sys >= 180 || dia < 60 || dia >= 120) return { status: 'CRITICAL', text: 'Critical' };
      if (sys < 100 || dia < 70) return { status: 'LOW', text: 'Low' };
      if (sys >= 140 || dia >= 90) return { status: 'HIGH', text: 'Elevated' };
      return { status: 'NORMAL', text: 'Normal' };
    }
  },
  { key: 'heartRate',  label: 'Heart Rate',         unit: 'bpm',   normal: (v) => {
      const n = Number(v); if (!Number.isFinite(n)) return { status: 'UNKNOWN', text: '—' };
      if (n < 50 || n >= 130) return { status: 'CRITICAL', text: 'Critical' };
      if (n < 60 || n >= 110) return { status: 'ABNORMAL', text: 'Abnormal' };
      return { status: 'NORMAL', text: 'Normal' };
    }
  },
  { key: 'temperature', label: 'Temperature',        unit: '\u00B0C', normal: (v) => {
      const n = Number(v); if (!Number.isFinite(n)) return { status: 'UNKNOWN', text: '—' };
      if (n < 35 || n >= 40) return { status: 'CRITICAL', text: 'Critical' };
      if (n < 36.1 || n >= 38) return { status: 'ABNORMAL', text: 'Abnormal' };
      return { status: 'NORMAL', text: 'Normal' };
    }
  },
  { key: 'oxygen',     label: 'Oxygen Saturation (SpO2)', unit: '%', normal: (v) => {
      const n = Number(v); if (!Number.isFinite(n)) return { status: 'UNKNOWN', text: '—' };
      if (n < 90) return { status: 'CRITICAL', text: 'Critical' };
      if (n < 94) return { status: 'LOW', text: 'Low' };
      return { status: 'NORMAL', text: 'Normal' };
    }
  },
  { key: 'glucose',    label: 'Blood Glucose',      unit: 'mg/dL', normal: (v) => {
      const n = Number(v); if (!Number.isFinite(n)) return { status: 'UNKNOWN', text: '—' };
      if (n < 60 || n >= 250) return { status: 'CRITICAL', text: 'Critical' };
      if (n < 70 || n >= 180) return { status: 'ABNORMAL', text: 'Abnormal' };
      return { status: 'NORMAL', text: 'Normal' };
    }
  },
];

// --- Lab field metadata (must match parseMedicalReport.js) ---------------
// The keys here match the keys the parser produces in `labFindings`. The
// status is read directly from `labFindings[${key}_status]` so we don't
// duplicate the threshold table in the PDF generator.
const LAB_FIELDS = [
  { key: 'hemoglobin',   label: 'Hemoglobin (Hb)',     unit: 'g/dL'    },
  { key: 'wbc',          label: 'WBC / TLC',           unit: '/µL'     },
  { key: 'platelet',     label: 'Platelet Count',      unit: '/µL'     },
  { key: 'rbc',          label: 'RBC',                 unit: 'million/µL' },
  { key: 'esr',          label: 'ESR',                 unit: 'mm/hr'   },
  { key: 'neutrophils',  label: 'Neutrophils',         unit: '%'       },
  { key: 'lymphocytes',  label: 'Lymphocytes',         unit: '%'       },
  { key: 'glucose',      label: 'Blood Glucose',       unit: 'mg/dL'   },
  { key: 'creatinine',   label: 'Serum Creatinine',    unit: 'mg/dL'   },
  { key: 'urea',         label: 'Blood Urea / BUN',    unit: 'mg/dL'   },
];

// --- Low-level PDF helpers -----------------------------------------------
function setFill(doc, [r, g, b]) {
  doc.setFillColor(r, g, b);
}
function setText(doc, [r, g, b]) {
  doc.setTextColor(r, g, b);
}
function setDraw(doc, [r, g, b]) {
  doc.setDrawColor(r, g, b);
}

function ensureSpace(doc, neededY, lineGap = 6) {
  // Returns the cursor y, adding a new page if `neededY` would overflow.
  const limit = PAGE_H - MARGIN_BOTTOM;
  if (neededY > limit) {
    doc.addPage();
    return MARGIN_TOP;
  }
  return neededY + lineGap;
}

function drawPageChrome(doc, pageNum, totalPagesPlaceholder) {
  // Footer rule + page meta on every page.
  const y = PAGE_H - 12;
  setDraw(doc, COLOR.rule);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(
    'Shuruksha Link  ·  Confidential physician report',
    MARGIN_X,
    y + 4.5
  );
  doc.text(
    `Page ${pageNum}`,
    PAGE_W - MARGIN_X,
    y + 4.5,
    { align: 'right' }
  );
}

function drawHeader(doc) {
  // Hospital letterhead — no colored band, just a clean double rule.
  const topY = 14;
  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('Shuruksha Link', MARGIN_X, topY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  setText(doc, COLOR.inkMuted);
  doc.text('Community Health Worker Triage Report', MARGIN_X, topY + 5.2);

  // Right-aligned report metadata column.
  const now = new Date();
  const stamp = now.toLocaleString('en-GB', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  const reportId = `SL-${now.getTime()}`;

  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Generated', PAGE_W - MARGIN_X, topY - 4, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  setText(doc, COLOR.ink);
  doc.text(stamp, PAGE_W - MARGIN_X, topY, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setText(doc, COLOR.inkMuted);
  doc.text('Report ID', PAGE_W - MARGIN_X, topY + 4, { align: 'right' });
  doc.text(reportId, PAGE_W - MARGIN_X, topY + 8, { align: 'right' });

  // Double rule beneath the letterhead.
  setDraw(doc, COLOR.ink);
  doc.setLineWidth(0.6);
  doc.line(MARGIN_X, 26, PAGE_W - MARGIN_X, 26);
  setDraw(doc, COLOR.rule);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, 27.2, PAGE_W - MARGIN_X, 27.2);
}

function drawSectionTitle(doc, y, text) {
  // Print-style: thin top rule, uppercase tracked caps title, no accent.
  setDraw(doc, COLOR.rule);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, y - 1, MARGIN_X + CONTENT_W, y - 1);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  setText(doc, COLOR.ink);
  // Uppercase + small letter-spacing for a clinical look.
  doc.text(text.toUpperCase(), MARGIN_X, y + 4);
  return y + 9;
}

function drawWrappedText(doc, text, x, y, opts = {}) {
  const {
    maxWidth = CONTENT_W,
    font = 'helvetica',
    style = 'normal',
    size = 10,
    color = COLOR.ink,
    lineHeight = 4.6,
  } = opts;
  if (!text) return y;
  setText(doc, color);
  doc.setFont(font, style);
  doc.setFontSize(size);
  const lines = doc.splitTextToSize(text, maxWidth);
  doc.text(lines, x, y);
  return y + lines.length * lineHeight;
}

function drawBulletList(doc, items, y) {
  if (!items || items.length === 0) {
    setText(doc, COLOR.inkFaint);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.text('None recorded.', MARGIN_X, y);
    return y + 5;
  }
  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  let cursor = y;
  items.forEach((item) => {
    // Numbered list reads more clinical than a filled circle.
    const idx = items.indexOf(item) + 1;
    const lines = doc.splitTextToSize(item, CONTENT_W - 10);
    setText(doc, COLOR.inkMuted);
    doc.setFont('helvetica', 'bold');
    doc.text(`${idx}.`, MARGIN_X, cursor);
    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.text(lines, MARGIN_X + 8, cursor);
    cursor += lines.length * 4.6 + 1.2;
  });
  return cursor;
}

function drawStatusPill(doc, status, cx, cy) {
  // Small colored pill: the only color in the table.
  const STATUS_PALETTE = {
    NORMAL:   { rgb: COLOR.low,      text: 'NORMAL'   },
    ABNORMAL: { rgb: COLOR.medium,   text: 'ABNORMAL' },
    LOW:      { rgb: COLOR.medium,   text: 'LOW'      },
    HIGH:     { rgb: COLOR.medium,   text: 'HIGH'     },
    CRITICAL: { rgb: COLOR.critical, text: 'CRITICAL' },
    UNKNOWN:  { rgb: COLOR.inkFaint, text: '\u2014'     },
  };
  const meta = STATUS_PALETTE[status] || STATUS_PALETTE.UNKNOWN;
  const w = 22;
  const h = 5;
  const x = cx - w / 2;
  const py = cy - h + 0.5;
  setFill(doc, meta.rgb);
  doc.roundedRect(x, py, w, h, 1, 1, 'F');
  setText(doc, [255, 255, 255]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text(meta.text, cx, cy, { align: 'center' });
}

function drawVitalsTable(doc, vitals, y) {
  // Parameter | Value | Status — thin rules, no fill bands.
  const colX = [MARGIN_X, MARGIN_X + 80, MARGIN_X + 110, MARGIN_X + CONTENT_W];
  const rowH = 8;

  // Header rule
  setDraw(doc, COLOR.ink);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_W, y);
  y += 4.5;

  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('PARAMETER', colX[0] + 2, y);
  doc.text('VALUE',     colX[1] + 2, y);
  doc.text('UNIT',      colX[2] + 2, y);
  doc.text('STATUS',    colX[3] - 2, y, { align: 'right' });
  y += 2.5;

  setDraw(doc, COLOR.rule);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_W, y);
  y += 4.5;

  // Body rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  VITAL_FIELDS.forEach((f) => {
    const raw = vitals?.[f.key];
    const hasValue = !(raw === '' || raw == null);
    const value = hasValue ? String(raw) : '\u2014';
    const evalRes = hasValue ? f.normal(raw) : { status: 'UNKNOWN', text: '\u2014' };

    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.text(f.label, colX[0] + 2, y);
    doc.setFont('helvetica', 'bold');
    doc.text(value, colX[1] + 2, y);
    doc.setFont('helvetica', 'normal');
    setText(doc, COLOR.inkMuted);
    doc.text(f.unit, colX[2] + 2, y);

    drawStatusPill(doc, evalRes.status, colX[3] - 12, y + 1.2);
    y += rowH;

    // Hairline below each row.
    setDraw(doc, COLOR.rule);
    doc.setLineWidth(0.1);
    doc.line(MARGIN_X, y - 1.5, MARGIN_X + CONTENT_W, y - 1.5);
  });

  // Bottom rule (slightly heavier for the table close).
  setDraw(doc, COLOR.ink);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y - 1.5, MARGIN_X + CONTENT_W, y - 1.5);
  return y + 2;
}

function drawSeverityBanner(doc, severity, confidence) {
  const meta = SEVERITY_PALETTE[severity] || SEVERITY_PALETTE.LOW;
  const y = 32;
  const bannerH = 22;
  const stripW = 6;

  // Outer thin border.
  setDraw(doc, COLOR.ink);
  doc.setLineWidth(0.4);
  doc.rect(MARGIN_X, y, CONTENT_W, bannerH);

  // Colored left strip — the only colored block in the report.
  setFill(doc, meta.rgb);
  doc.rect(MARGIN_X, y, stripW, bannerH, 'F');

  // Severity label inside the strip (white, vertical-feeling uppercase).
  setText(doc, [255, 255, 255]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('SEV', MARGIN_X + stripW / 2, y + 5, { align: 'center' });
  doc.setFontSize(14);
  doc.text(meta.label, MARGIN_X + stripW / 2, y + 14, { align: 'center' });

  // Severity word + descriptor (left of the strip's right edge).
  const textX = MARGIN_X + stripW + 4;
  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(`${meta.word} — ${meta.label}`, textX, y + 8);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  setText(doc, COLOR.inkMuted);
  const desc = {
    LOW:      'Patient is stable. May be observed or advised on self-care.',
    MEDIUM:   'Requires clinician review within 24 to 48 hours.',
    HIGH:     'Requires same-day facility evaluation.',
    CRITICAL: 'Life-threatening. Refer to hospital immediately.',
  }[severity] || '';
  const descLines = doc.splitTextToSize(desc, CONTENT_W - stripW - 10);
  doc.text(descLines, textX, y + 13);

  // Right-aligned confidence.
  if (confidence) {
    setText(doc, COLOR.inkMuted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('CONFIDENCE', MARGIN_X + CONTENT_W - 4, y + 5, { align: 'right' });
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    setText(doc, COLOR.ink);
    doc.text(
      confidence.toUpperCase(),
      MARGIN_X + CONTENT_W - 4,
      y + 12,
      { align: 'right' }
    );
  }

  return y + bannerH + 4;
}

function drawAlerts(doc, alerts, y) {
  if (!Array.isArray(alerts) || alerts.length === 0) {
    return y;
  }
  y = drawSectionTitle(doc, y, 'Anomaly Findings');
  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  let cursor = y;
  alerts.forEach((a, i) => {
    const lines = doc.splitTextToSize(a, CONTENT_W - 10);
    setText(doc, COLOR.inkMuted);
    doc.setFont('helvetica', 'bold');
    doc.text(`${i + 1}.`, MARGIN_X, cursor);
    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.text(lines, MARGIN_X + 8, cursor);
    cursor += lines.length * 4.6 + 1.2;
  });
  return cursor;
}

// --- Lab findings helpers ------------------------------------------------
// Render a structured Parameter | Value | Unit | Status table for the
// extracted lab values. Same visual style as the vitals table. Returns the
// new y cursor; returns the input y unchanged if there are no findings.
function drawLabFindingsTable(doc, labFindings, y) {
  if (!labFindings || typeof labFindings !== 'object') return y;
  // Build the row list up-front so we can early-out cleanly.
  const rows = LAB_FIELDS
    .map((f) => {
      const raw = labFindings[f.key];
      if (raw === '' || raw == null) return null;
      return {
        label: f.label,
        value: String(raw),
        unit: f.unit,
        status: labFindings[`${f.key}_status`] || 'UNKNOWN',
      };
    })
    .filter(Boolean);
  if (rows.length === 0) return y;

  y = drawSectionTitle(doc, y, 'Lab Findings');

  // Reuse the same column layout as drawVitalsTable for visual consistency.
  const colX = [MARGIN_X, MARGIN_X + 80, MARGIN_X + 110, MARGIN_X + CONTENT_W];
  const rowH = 8;

  setDraw(doc, COLOR.ink);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_W, y);
  y += 4.5;

  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('PARAMETER', colX[0] + 2, y);
  doc.text('VALUE',     colX[1] + 2, y);
  doc.text('UNIT',      colX[2] + 2, y);
  doc.text('STATUS',    colX[3] - 2, y, { align: 'right' });
  y += 2.5;

  setDraw(doc, COLOR.rule);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_W, y);
  y += 4.5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  rows.forEach((r) => {
    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.text(r.label, colX[0] + 2, y);
    doc.setFont('helvetica', 'bold');
    doc.text(r.value, colX[1] + 2, y);
    doc.setFont('helvetica', 'normal');
    setText(doc, COLOR.inkMuted);
    doc.text(r.unit, colX[2] + 2, y);

    drawStatusPill(doc, r.status, colX[3] - 12, y + 1.2);
    y += rowH;

    setDraw(doc, COLOR.rule);
    doc.setLineWidth(0.1);
    doc.line(MARGIN_X, y - 1.5, MARGIN_X + CONTENT_W, y - 1.5);
  });

  setDraw(doc, COLOR.ink);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y - 1.5, MARGIN_X + CONTENT_W, y - 1.5);
  return y + 2;
}

// Render the rule-based lab alerts as a numbered list, identical in style
// to the vitals-derived Anomaly Findings section on page 1.
function drawLabAlerts(doc, labAlerts, y) {
  if (!Array.isArray(labAlerts) || labAlerts.length === 0) return y;
  y = drawSectionTitle(doc, y, 'Lab Alerts');
  let cursor = y;
  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  labAlerts.forEach((a, i) => {
    const lines = doc.splitTextToSize(a, CONTENT_W - 10);
    setText(doc, COLOR.inkMuted);
    doc.setFont('helvetica', 'bold');
    doc.text(`${i + 1}.`, MARGIN_X, cursor);
    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.text(lines, MARGIN_X + 8, cursor);
    cursor += lines.length * 4.6 + 1.2;
  });
  return cursor;
}

function drawMonoBlock(doc, label, text, y) {
  y = drawSectionTitle(doc, y, label);
  const safeText = text && text.trim().length > 0 ? text.trim() : 'Not provided.';
  doc.setFont('courier', 'normal');
  doc.setFontSize(9);
  setText(doc, COLOR.ink);
  const lines = doc.splitTextToSize(safeText, CONTENT_W - 8);
  const blockH = lines.length * 4.4 + 6;

  // Thin border, no fill.
  setDraw(doc, COLOR.rule);
  doc.setLineWidth(0.2);
  doc.rect(MARGIN_X, y, CONTENT_W, blockH);

  doc.text(lines, MARGIN_X + 4, y + 5);
  return y + blockH + 3;
}

// --- Main export ---------------------------------------------------------
/**
 * Generate a physician PDF and trigger browser download.
 *
 * @param {object} params
 * @param {object} params.verdict          - AI verdict (severity, summary, …)
 * @param {object} [params.vitals]         - { bp, heartRate, temperature, oxygen, glucose }
 * @param {string[]} [params.alerts]       - Local anomaly detector messages
 * @param {string} [params.voiceTranscript] - Captured voice text
 * @param {string} [params.ocrText]        - OCR text from document scan
 * @param {object} [params.labFindings]    - Parsed lab values { key: value, key_status: '...' }
 * @param {string[]} [params.labAlerts]    - Rule-based lab alerts
 * @returns {{ filename: string, pageCount: number }}
 */
export function generatePhysicianPdf({
  verdict,
  vitals = {},
  alerts = [],
  voiceTranscript = '',
  ocrText = '',
  labFindings = {},
  labAlerts = [],
} = {}) {
  if (!verdict) {
    throw new Error('generatePhysicianPdf: verdict is required.');
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });

  // --- Page 1: header + severity banner + summary + vitals + anomaly findings
  drawHeader(doc);
  let y = drawSeverityBanner(doc, verdict.severity, verdict.confidence);

  y = drawSectionTitle(doc, y, 'Clinical Summary');
  y = drawWrappedText(
    doc,
    verdict.summary || 'No clinical summary provided.',
    MARGIN_X,
    y,
    { size: 10.5, lineHeight: 4.8 }
  );
  y += 1;

  y = ensureSpace(doc, y, 6);
  y = drawSectionTitle(doc, y, 'Patient Vitals');
  y = drawVitalsTable(doc, vitals, y);
  y = ensureSpace(doc, y, 2);

  // Lab findings + lab alerts live on page 1, right after the vitals-
  // derived anomaly findings. Same print style, same colored status pills.
  y = ensureSpace(doc, y, 6);
  y = drawLabFindingsTable(doc, labFindings, y);
  y = ensureSpace(doc, y, 2);
  y = drawLabAlerts(doc, labAlerts, y);

  y = drawAlerts(doc, alerts, y);
  drawPageChrome(doc, 1);

  // --- Page 2+: differential + actions + referral + voice + OCR
  doc.addPage();
  drawHeader(doc);
  y = MARGIN_TOP + 6;

  y = drawSectionTitle(doc, y, 'Possible Conditions');
  y = drawBulletList(doc, verdict.possible_conditions, y);
  y = ensureSpace(doc, y, 4);

  y = drawSectionTitle(doc, y, 'Recommended Actions');
  y = drawBulletList(doc, verdict.recommended_actions, y);
  y = ensureSpace(doc, y, 4);

  y = drawSectionTitle(doc, y, 'Referral Recommendation');
  y = drawWrappedText(
    doc,
    verdict.referral || 'No referral guidance provided.',
    MARGIN_X,
    y
  );
  y = ensureSpace(doc, y, 4);

  y = drawMonoBlock(doc, 'Voice Transcript', voiceTranscript, y);
  y = ensureSpace(doc, y, 4);

  y = drawMonoBlock(doc, 'OCR Extracted Text', ocrText, y);

  // --- Final AI disclaimer block on the last page
  y = ensureSpace(doc, y, 14);
  setDraw(doc, COLOR.rule);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_W, y);
  y += 5;
  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  doc.text(
    'Disclaimer — This report is generated by an AI decision-support tool. It is not a substitute for a physician\'s clinical judgment and must be reviewed by a qualified medical professional before any clinical action is taken.',
    MARGIN_X,
    y,
    { maxWidth: CONTENT_W, lineHeightFactor: 1.4 }
  );

  // Redraw chrome on every page (we added page 2 explicitly).
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawPageChrome(doc, p);
  }

  // --- Filename + download
  const sev = (verdict.severity || 'LOW').toLowerCase();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `shuruksha-link-triage-${sev}-${stamp}.pdf`;

  doc.save(filename);
  return { filename, pageCount: totalPages };
}

export default generatePhysicianPdf;
