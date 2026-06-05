// Shuruksha Link — Physician PDF report generator
// Pure utility that turns the assembled triage payload into a print-ready
// A4 clinical report using jsPDF. Designed to be called from TriageResult.
//
// Layout (professional diagnostic-report style, English only — references:
// Ibn Sina, Labaid, Evercare, United Hospital diagnostic report aesthetics):
//
//   Header (every page)
//     Top-left  : SHURUKSHA LINK  /  Community Health Triage Report
//     Top-right : Report ID
//                 Generated Time
//                 Severity
//     Thin divider line underneath.
//
//   Page 1
//     -1. EMERGENCY OVERRIDE     (red callout — only when offline engine triggered; Step 22)
//      0. REFERRAL PLAN          (Facility | Urgency | Transport | Checklist — only when referralPlan is supplied; Step 23)
//      1. PATIENT INFORMATION     (Name | Age | Gender | Phone | Address — black/gray table)
//     2. PATIENT VITALS          (Parameter | Value | Unit | Status, pills)
//     3. ANOMALY FINDINGS        (numbered list)
//     4. LAB FINDINGS            (Parameter | Result | Unit | Status, pills)
//     5. LAB ALERTS              (numbered list)
//
//   Page 2
//     6. CLINICAL SUMMARY        (paragraph)
//     7. POSSIBLE CONDITIONS     (numbered list)
//     8. RECOMMENDED ACTIONS     (numbered list)
//     9. FIRST AID RECOMMENDATIONS (checkmark list)
//    10. REFERRAL RECOMMENDATION (paragraph)
//    11. VOICE TRANSCRIPT / SYMPTOMS NOTES (monospace bordered block)
//    12. OCR EXTRACTED TEXT      (monospace bordered block)
//
//   Footer (every page)
//     Shuruksha Link  ·  Confidential Clinical Report  ·  Page X of Y
//
// Typography (English only — Helvetica, Helvetica-Bold, Courier):
//   Document title  : Helvetica-Bold 18pt
//   H2 section caps : Helvetica-Bold 9.5pt, uppercase
//   Body text       : Helvetica 10pt
//   Labels / values : Helvetica-Bold 10pt
//   Monospace       : Courier 9pt
//   Footnote / meta : Helvetica 8pt
//
// Color usage: deliberately minimal. Color is used ONLY for:
//   - The severity strip (top of page 1)
//   - The status pills in the vitals / lab findings tables
// Everything else is black / dark gray / light gray borders — a print-
// friendly clinical look identical to private-hospital diagnostic reports.

import { jsPDF } from 'jspdf';

// --- A4 geometry ---------------------------------------------------------
const PAGE_W = 210;        // mm
const PAGE_H = 297;        // mm
const MARGIN_X = 18;
const MARGIN_TOP = 22;
const MARGIN_BOTTOM = 20;
const CONTENT_W = PAGE_W - MARGIN_X * 2; // 174 mm

// --- Color tokens (print-friendly, used sparingly) -----------------------
// IMPORTANT: color is used ONLY for the severity strip and status pills.
const COLOR = {
  ink:        [17, 24, 39],   // slate-900 — body text
  inkMuted:   [71, 85, 105],  // slate-600 — labels, meta
  inkFaint:   [148, 163, 184], // slate-400 — rules
  rule:       [203, 213, 225], // slate-300 — table rules
  ruleStrong: [100, 116, 139], // slate-500 — emphasis rules
  bg:         [255, 255, 255], // white
  // Severity palette — used only on the severity strip.
  low:        [16, 185, 129],  // emerald-500  -> Stable
  medium:     [217, 119, 6],   // amber-600    -> Caution
  high:       [220, 38, 38],   // red-600      -> Urgent
  critical:   [159, 18, 57],   // rose-800     -> Emergency
};

// Severity visual mapping — kept in sync with TriageResult's SEVERITY_META.
const SEVERITY_PALETTE = {
  LOW:      { label: 'LOW',      rgb: COLOR.low,      rank: 1, word: 'Stable'    },
  MEDIUM:   { label: 'MEDIUM',   rgb: COLOR.medium,   rank: 2, word: 'Caution'   },
  HIGH:     { label: 'HIGH',     rgb: COLOR.high,     rank: 3, word: 'Urgent'    },
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
  { key: 'temperature', label: 'Temperature',        unit: '°C', normal: (v) => {
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
  { key: 'hemoglobin',   label: 'Hemoglobin (Hb)',     unit: 'g/dL'         },
  { key: 'wbc',          label: 'WBC / TLC',           unit: '/µL'          },
  { key: 'platelet',     label: 'Platelet Count',      unit: '/µL'          },
  { key: 'rbc',          label: 'RBC',                 unit: 'million/µL'   },
  { key: 'esr',          label: 'ESR',                 unit: 'mm/hr'        },
  { key: 'neutrophils',  label: 'Neutrophils',         unit: '%'            },
  { key: 'lymphocytes',  label: 'Lymphocytes',         unit: '%'            },
  { key: 'glucose',      label: 'Blood Glucose',       unit: 'mg/dL'        },
  { key: 'creatinine',   label: 'Serum Creatinine',    unit: 'mg/dL'        },
  { key: 'urea',         label: 'Blood Urea / BUN',    unit: 'mg/dL'        },
];

// --- Low-level PDF helpers -----------------------------------------------
function setFill(doc, [r, g, b]) { doc.setFillColor(r, g, b); }
function setText(doc, [r, g, b]) { doc.setTextColor(r, g, b); }
function setDraw(doc, [r, g, b]) { doc.setDrawColor(r, g, b); }

function ensureSpace(doc, neededY, lineGap = 6) {
  // Returns the cursor y, adding a new page if `neededY` would overflow.
  const limit = PAGE_H - MARGIN_BOTTOM;
  if (neededY > limit) {
    doc.addPage();
    return MARGIN_TOP;
  }
  return neededY + lineGap;
}

function pageCount(doc) { return doc.getNumberOfPages(); }

// --- Header (every page) -------------------------------------------------
// Top-left  : SHURUKSHA LINK
//             Community Health Triage Report
// Top-right : Report ID
//             Generated Time
//             Severity
// Thin divider line underneath.
function drawHeader(doc, opts = {}) {
  const { severity = 'LOW', reportId = '', generatedAt = null } = opts;
  const topY = 14;

  // --- Top-left: project name + report subtitle
  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('SHURUKSHA LINK', MARGIN_X, topY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  setText(doc, COLOR.inkMuted);
  doc.text('Community Health Triage Report', MARGIN_X, topY + 5);

  // --- Top-right: Report ID / Generated Time / Severity
  const rightX = PAGE_W - MARGIN_X;
  const meta = metaFor(generatedAt, reportId, severity);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setText(doc, COLOR.inkMuted);
  doc.text('Report ID',       rightX, topY - 4, { align: 'right' });
  doc.text('Generated Time',  rightX, topY + 0, { align: 'right' });
  doc.text('Severity',        rightX, topY + 4, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  setText(doc, COLOR.ink);
  doc.text(meta.reportId,     rightX, topY,    { align: 'right' });
  doc.text(meta.generatedAt,  rightX, topY + 4, { align: 'right' });

  const sev = SEVERITY_PALETTE[severity] || SEVERITY_PALETTE.LOW;
  setText(doc, sev.rgb);
  doc.text(sev.label,         rightX, topY + 8, { align: 'right' });

  // --- Thin divider rule under the header
  setDraw(doc, COLOR.ruleStrong);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, 26, PAGE_W - MARGIN_X, 26);
}

function metaFor(generatedAt, reportId, severity) {
  const now = generatedAt instanceof Date ? generatedAt : new Date();
  const stamp = now.toLocaleString('en-GB', {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const id = reportId || `SL-${now.getTime()}`;
  return { generatedAt: stamp, reportId: id, severity: severity || 'LOW' };
}

// --- Page chrome / footer (every page) -----------------------------------
// Shuruksha Link  ·  Confidential Clinical Report  ·  Page X of Y
function drawPageChrome(doc, pageNum) {
  const y = PAGE_H - 12;
  setDraw(doc, COLOR.rule);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);

  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  const total = pageCount(doc);
  doc.text('Shuruksha Link', MARGIN_X, y + 4.5);
  doc.text(
    'Confidential Clinical Report',
    PAGE_W / 2,
    y + 4.5,
    { align: 'center' }
  );
  doc.text(
    `Page ${pageNum} of ${total}`,
    PAGE_W - MARGIN_X,
    y + 4.5,
    { align: 'right' }
  );
}

// --- Section title (clinical H2 — thin top rule, uppercase tracked caps) -
function drawSectionTitle(doc, y, text) {
  setDraw(doc, COLOR.rule);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, y - 1, MARGIN_X + CONTENT_W, y - 1);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  setText(doc, COLOR.ink);
  doc.text(text.toUpperCase(), MARGIN_X, y + 4);
  return y + 8;
}

// --- Wrapped paragraph text ----------------------------------------------
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

// --- Numbered list (used by Anomaly Findings, Lab Alerts, etc.) ---------
function drawNumberedList(doc, items, y) {
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
  items.forEach((item, i) => {
    const lines = doc.splitTextToSize(String(item), CONTENT_W - 10);
    setText(doc, COLOR.inkMuted);
    doc.setFont('helvetica', 'bold');
    doc.text(`${i + 1}.`, MARGIN_X, cursor);
    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.text(lines, MARGIN_X + 8, cursor);
    cursor += lines.length * 4.6 + 1.4;
  });
  return cursor;
}

// --- Status pill (the only color in the vitals / lab tables) -------------
function drawStatusPill(doc, status, cx, cy) {
  const STATUS_PALETTE = {
    NORMAL:   { rgb: COLOR.low,      text: 'NORMAL'   },
    ABNORMAL: { rgb: COLOR.medium,   text: 'ABNORMAL' },
    LOW:      { rgb: COLOR.medium,   text: 'LOW'      },
    HIGH:     { rgb: COLOR.medium,   text: 'HIGH'     },
    CRITICAL: { rgb: COLOR.critical, text: 'CRITICAL' },
    UNKNOWN:  { rgb: COLOR.inkFaint, text: '—'        },
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

// --- Severity strip (top of page 1 — the only colored block) --------------
// A thin left rule, a 4mm colored strip, a one-line label + descriptor,
// and a right-aligned confidence. NO banner border, NO green first-aid
// accent elsewhere — color is reserved for severity + status pills only.
function drawSeverityStrip(doc, severity, confidence) {
  const meta = SEVERITY_PALETTE[severity] || SEVERITY_PALETTE.LOW;
  const y = 32;
  const stripH = 12;
  const stripW = 4;

  // Thin left rule
  setDraw(doc, COLOR.ruleStrong);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, y, MARGIN_X, y + stripH);

  // Colored severity strip
  setFill(doc, meta.rgb);
  doc.rect(MARGIN_X + 2, y, stripW, stripH, 'F');

  // Severity label + descriptor
  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Severity: ${meta.label} — ${meta.word}`, MARGIN_X + 9, y + 5.5);

  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const desc = {
    LOW:      'Patient is stable. May be observed or advised on self-care.',
    MEDIUM:   'Requires clinician review within 24 to 48 hours.',
    HIGH:     'Requires same-day facility evaluation.',
    CRITICAL: 'Life-threatening. Refer to hospital immediately.',
  }[severity] || '';
  doc.text(desc, MARGIN_X + 9, y + 10);

  // Right-aligned confidence
  if (confidence) {
    setText(doc, COLOR.inkMuted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(
      `CONFIDENCE: ${String(confidence).toUpperCase()}`,
      PAGE_W - MARGIN_X,
      y + 5.5,
      { align: 'right' }
    );
  }

  return y + stripH + 4;
}

// --- Step 22: EMERGENCY OVERRIDE callout (red box, top of page 1) --------
// Drawn between the severity strip and Section 0 (Patient Information)
// ONLY when the offline engine fired. Uses the rose-800 emergency color
// for a thick left rule + title bar, then renders the triggered reasons
// and the first-aid list. The referral is a separate line at the bottom.
// Designed to be the first thing a clinician sees on the report.
function drawEmergencyOverrideBlock(doc, override, y) {
  if (!override || !override.triggered) return y;
  const reasons = Array.isArray(override.reasons) ? override.reasons : [];
  const firstAid = Array.isArray(override.firstAid) ? override.firstAid : [];
  const referral = String(override.referral || '').trim();

  // Rough height: title bar (8) + 4.6/reason + 6/header + 4.6/item + referral + padding
  const innerX = MARGIN_X + 4;
  const innerW = CONTENT_W - 8;
  const titleH = 8;
  const reasonH = Math.max(reasons.length, 1) * 4.6;
  const faHeaderH = 6;
  const faItemH = Math.max(firstAid.length, 1) * 4.6;
  const refH = referral ? 8 : 0;
  const padTop = 4;
  const padBottom = 4;
  const totalH = padTop + titleH + reasonH + faHeaderH + faItemH + refH + padBottom;

  // Background callout (light rose wash)
  setFill(doc, [255, 241, 242]); // rose-50
  setDraw(doc, COLOR.critical);   // rose-800
  doc.setLineWidth(0.8);
  doc.rect(MARGIN_X, y, CONTENT_W, totalH, 'FD');

  // Title bar (solid rose-800 strip)
  setFill(doc, COLOR.critical);
  doc.rect(MARGIN_X, y, CONTENT_W, titleH, 'F');

  setText(doc, [255, 255, 255]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('EMERGENCY OVERRIDE', innerX, y + 5.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('CRITICAL — Life-threatening findings', MARGIN_X + CONTENT_W - 2, y + 5.5, { align: 'right' });

  // Reasons
  let cursor = y + titleH + padTop;
  setText(doc, COLOR.critical);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('TRIGGERED REASONS', innerX, cursor);
  cursor += 5;

  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  if (reasons.length === 0) {
    doc.text('Critical vitals detected.', innerX, cursor);
    cursor += 4.6;
  } else {
    reasons.forEach((r) => {
      const lines = doc.splitTextToSize(String(r), innerW - 6);
      doc.text('•', innerX, cursor);
      doc.text(lines, innerX + 4, cursor);
      cursor += lines.length * 4.4;
    });
  }
  cursor += 2;

  // First aid
  setText(doc, COLOR.critical);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('IMMEDIATE FIRST AID', innerX, cursor);
  cursor += 5;

  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  if (firstAid.length === 0) {
    doc.text('Stabilize and refer immediately.', innerX, cursor);
    cursor += 4.6;
  } else {
    firstAid.forEach((a) => {
      const lines = doc.splitTextToSize(String(a), innerW - 6);
      doc.text('•', innerX, cursor);
      doc.text(lines, innerX + 4, cursor);
      cursor += lines.length * 4.4;
    });
  }
  cursor += 2;

  // Referral
  if (referral) {
    setFill(doc, COLOR.critical);
    const refY = y + totalH - refH;
    doc.rect(MARGIN_X, refY, CONTENT_W, refH, 'F');
    setText(doc, [255, 255, 255]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    const refLines = doc.splitTextToSize(referral, CONTENT_W - 8);
    doc.text(refLines, innerX, refY + 5.5);
  }

  return y + totalH + 4;
}

// --- Step 23: REFERRAL PLAN block (Section 0 on page 1) -----------------
// Structured 5-tier referral plan. Renders Facility / Urgency / Transportation
// / Recommendation / Transfer Checklist as a black/gray clinical block that
// matches the patient-information table aesthetic. Color is reserved for a
// thin left rule tinted to the tier's severity, and the level badge — never
// a flood fill. Null/undefined plan → no-op (returns y unchanged).
function drawReferralPlanBlock(doc, plan, y) {
  if (!plan || typeof plan !== 'object') return y;

  const level = String(plan.level || 'LOW').toUpperCase();
  const facilityType = String(plan.facilityType || '—').trim() || '—';
  const urgency = String(plan.urgency || '—').trim() || '—';
  const transportation = String(plan.transportation || '—').trim() || '—';
  const recommendation = String(plan.recommendation || '').trim();
  const checklist = Array.isArray(plan.checklist) ? plan.checklist : [];

  // Tier accent color — only used for the left rule + level badge text.
  const accent =
    level === 'EMERGENCY' || level === 'CRITICAL' ? COLOR.critical
      : level === 'HIGH'   ? COLOR.high
      : level === 'MEDIUM' ? COLOR.medium
      :                       COLOR.low;

  // Section title row
  y = drawSectionTitle(doc, y, 'Referral Plan');

  // Compute body height up front so we can draw the frame once.
  // Layout (inside the frame):
  //   level strip  : 8mm  (badge + label)
  //   meta rows    : 3 × 6 = 18mm  (Facility / Urgency / Transport)
  //   recommendation paragraph : variable
  //   checklist    : header 5 + items * 4.6
  const innerX = MARGIN_X + 6;
  const innerW = CONTENT_W - 12;
  const stripH = 8;
  const metaRowH = 6;
  const recLines = recommendation
    ? doc.splitTextToSize(recommendation, innerW)
    : [];
  const recH = recommendation ? (recLines.length * 4.6 + 6) : 0;
  const clHeaderH = checklist.length > 0 ? 6 : 0;
  const clItemH = checklist.length * 4.4;
  const padTop = 3;
  const padBottom = 4;
  const bodyH = stripH + metaRowH * 3 + recH + clHeaderH + clItemH;
  const totalH = padTop + bodyH + padBottom;

  // Light wash background
  setFill(doc, [248, 250, 252]); // slate-50
  setDraw(doc, COLOR.rule);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN_X, y, CONTENT_W, totalH, 'FD');

  // Thick left rule tinted to tier
  setFill(doc, accent);
  doc.rect(MARGIN_X, y, 1.6, totalH, 'F');

  let cursor = y + padTop;

  // --- Level strip
  setText(doc, accent);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('REFERRAL LEVEL', innerX, cursor + 3.2);

  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(level, innerX + 30, cursor + 3.2);
  cursor += stripH;

  // --- Meta rows: Facility / Urgency / Transportation
  const metaRows = [
    { label: 'Facility',  value: facilityType },
    { label: 'Urgency',   value: urgency },
    { label: 'Transport', value: transportation },
  ];
  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  metaRows.forEach((row) => {
    doc.text(row.label, innerX, cursor + 4);
    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    const valLines = doc.splitTextToSize(String(row.value), innerW - 32);
    doc.text(valLines, innerX + 32, cursor + 4);
    cursor += Math.max(metaRowH, valLines.length * 4.4 + 1);
  });

  // --- Recommendation paragraph
  if (recommendation) {
    cursor += 1;
    setText(doc, COLOR.inkMuted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('RECOMMENDATION', innerX, cursor);
    cursor += 4;
    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(recLines, innerX, cursor);
    cursor += recLines.length * 4.6 + 2;
  }

  // --- Transfer checklist
  if (checklist.length > 0) {
    setText(doc, COLOR.inkMuted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('TRANSFER CHECKLIST', innerX, cursor);
    cursor += 4.6;

    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    checklist.forEach((item) => {
      const lines = doc.splitTextToSize(String(item), innerW - 6);
      doc.text('•', innerX, cursor);
      doc.text(lines, innerX + 4, cursor);
      cursor += lines.length * 4.4;
    });
  }

  return y + totalH + 4;
}

// --- Section 0: PATIENT INFORMATION (table) ------------------------------
// Step 21 — demographics captured at intake. Pure black/gray print, no
// Bengali, no color. Two-column layout: bold slate-600 label, regular
// slate-900 value. Empty fields render as a muted em-dash placeholder.
function drawPatientInfoTable(doc, patientInfo, y) {
  const pi = (patientInfo && typeof patientInfo === 'object') ? patientInfo : {};
  const rows = [
    { label: 'Patient Name',  value: (pi.name    || '').toString().trim() },
    { label: 'Age',           value: Number.isFinite(Number(pi.age))
                                  ? `${Number(pi.age)} years` : '' },
    { label: 'Gender',        value: (pi.gender  || '').toString().trim() },
    { label: 'Phone',         value: (pi.phone   || '').toString().trim() },
    { label: 'Address',       value: (pi.address || '').toString().trim() },
  ];

  const labelColW = 42;   // mm — fixed label column
  const valueColX = MARGIN_X + labelColW;
  const valueColW = CONTENT_W - labelColW;
  const rowH = 7;

  // Outer border + bottom rule (clinical look, no fill).
  setDraw(doc, COLOR.ink);
  doc.setLineWidth(0.4);
  doc.rect(MARGIN_X, y, CONTENT_W, rowH * rows.length + 1);

  rows.forEach((r, i) => {
    const rowY = y + i * rowH;
    const textY = rowY + 4.6;

    // Vertical separator between label and value
    setDraw(doc, COLOR.rule);
    doc.setLineWidth(0.2);
    doc.line(valueColX, rowY, valueColX, rowY + rowH);

    // Label (bold, slate-600)
    setText(doc, COLOR.inkMuted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(r.label, MARGIN_X + 2, textY);

    // Value (regular, slate-900) — wrap if longer than value column.
    const trimmed = (r.value || '').trim();
    if (trimmed) {
      setText(doc, COLOR.ink);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      const lines = doc.splitTextToSize(trimmed, valueColW - 4);
      doc.text(lines, valueColX + 2, textY);
    } else {
      setText(doc, COLOR.inkFaint);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9.5);
      doc.text('—', valueColX + 2, textY);
    }

    // Horizontal hairline between rows (skip after last).
    if (i < rows.length - 1) {
      setDraw(doc, COLOR.rule);
      doc.setLineWidth(0.1);
      doc.line(MARGIN_X, rowY + rowH, MARGIN_X + CONTENT_W, rowY + rowH);
    }
  });

  return y + rowH * rows.length + 3;
}

// --- Section 1: PATIENT VITALS (table) -----------------------------------
function drawVitalsTable(doc, vitals, y) {
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

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  VITAL_FIELDS.forEach((f) => {
    const raw = vitals?.[f.key];
    const hasValue = !(raw === '' || raw == null);
    const value = hasValue ? String(raw) : '—';
    const evalRes = hasValue ? f.normal(raw) : { status: 'UNKNOWN', text: '—' };

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

    setDraw(doc, COLOR.rule);
    doc.setLineWidth(0.1);
    doc.line(MARGIN_X, y - 1.5, MARGIN_X + CONTENT_W, y - 1.5);
  });

  setDraw(doc, COLOR.ink);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y - 1.5, MARGIN_X + CONTENT_W, y - 1.5);
  return y + 2;
}

// --- Section 3: LAB FINDINGS (table) -------------------------------------
function drawLabFindingsTable(doc, labFindings, y) {
  if (!labFindings || typeof labFindings !== 'object') return y;
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
  doc.text('RESULT',    colX[1] + 2, y);
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

// --- Section 8: FIRST AID RECOMMENDATIONS (checkmark list) ---------------
// English-only rendering: always reads `item.en`. Color is intentionally
// NOT used here — the section is a flat checkmark list, in keeping with
// the rule that color is reserved for severity strip + status pills.
function drawFirstAidList(doc, firstAid, y) {
  const items = Array.isArray(firstAid?.firstAidItems) ? firstAid.firstAidItems : [];
  if (items.length === 0) return y;

  y = drawSectionTitle(doc, y, 'First Aid Recommendations');

  let cursor = y;
  items.forEach((it) => {
    const text = (it && typeof it === 'object') ? (it.en || it.bn || '') : String(it || '');
    if (!text) return;
    const lines = doc.splitTextToSize(text, CONTENT_W - 14);
    const blockH = lines.length * 4.6 + 1.4;

    // Checkmark glyph in dark gray
    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('✓', MARGIN_X + 2, cursor);

    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(lines, MARGIN_X + 8, cursor);
    cursor += blockH;
  });
  return cursor + 2;
}

// --- Section 10 / 11: Monospace bordered block ---------------------------
function drawMonoBlock(doc, label, text, y) {
  y = drawSectionTitle(doc, y, label);
  const safeText = text && text.trim().length > 0 ? text.trim() : 'Not provided.';
  doc.setFont('courier', 'normal');
  doc.setFontSize(9);
  setText(doc, COLOR.ink);
  const lines = doc.splitTextToSize(safeText, CONTENT_W - 8);
  const blockH = lines.length * 4.4 + 6;

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
 * The PDF is English-only and follows a private-hospital diagnostic report
 * layout (Ibn Sina / Labaid / Evercare / United Hospital style): clean
 * tables, thin rules, monochrome body, and color used ONLY for the
 * severity strip and status pills.
 *
 * Section order (13 sections total):
 *   Page 1 — 0 Referral Plan (Step 23, conditional), 1 Patient Information,
 *            2 Patient Vitals, 3 Anomaly Findings, 4 Lab Findings, 5 Lab Alerts
 *   Page 2 — 6 Clinical Summary, 7 Possible Conditions, 8 Recommended Actions,
 *            9 First Aid Recommendations, 10 Referral Recommendation,
 *           11 Voice Transcript, 12 OCR Extracted Text
 *
 * @param {object} params
 * @param {object} params.verdict          - AI verdict (severity, summary, …)
 * @param {object} [params.vitals]         - { bp, heartRate, temperature, oxygen, glucose }
 * @param {string[]} [params.alerts]       - Local anomaly detector messages
 * @param {string} [params.voiceTranscript] - Captured voice text
 * @param {string} [params.ocrText]        - OCR text from document scan
 * @param {object} [params.labFindings]    - Parsed lab values { key: value, key_status: '...' }
 * @param {string[]} [params.labAlerts]    - Rule-based lab alerts
 * @param {object} [params.firstAid]       - { firstAidTitle: {en,bn}, firstAidItems: [{en,bn}] }
 *                                           (PDF renders the English form only)
 * @param {object} [params.patientInfo]    - { name, age, gender, phone, address }
 *                                           Step 21 — rendered as Section 0 on page 1.
 *                                           English-only, black/gray print, no Bengali.
 * @param {object} [params.emergencyOverride] - Offline engine result (Step 22).
 *                                           When { triggered: true, ... } is passed,
 *                                           a red callout is rendered at the very
 *                                           top of page 1 (above the severity strip
 *                                           and Section 0). Null/undefined = hidden.
 * @param {object} [params.referralPlan]    - { level, facilityType, urgency,
 *                                           transportation, recommendation,
 *                                           checklist } from the Smart Referral
 *                                           Directory (Step 23). When supplied,
 *                                           a structured block is rendered as
 *                                           Section 0 on page 1, between the
 *                                           emergency override callout (if any)
 *                                           and Patient Information. When the
 *                                           Emergency Override fires, its tier
 *                                           is forced to EMERGENCY so the block
 *                                           always matches the red callout.
 * @param {string} [params.outputLanguage] - Accepted for API compatibility.
 *                                           The PDF is always English.
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
  firstAid = null,
  patientInfo = {},
  emergencyOverride = null,
  referralPlan = null,
  outputLanguage = 'en', // accepted but ignored — PDF is English-only
} = {}) {
  if (!verdict) {
    throw new Error('generatePhysicianPdf: verdict is required.');
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const generatedAt = new Date();
  const reportId = `SL-${generatedAt.getTime()}`;

  // =====================================================================
  // PAGE 1 — header, severity strip, sections 0..5
  // =====================================================================
  drawHeader(doc, {
    severity: verdict.severity,
    reportId,
    generatedAt,
  });
  let y = drawSeverityStrip(doc, verdict.severity, verdict.confidence);

  // -1. EMERGENCY OVERRIDE (Step 22) — sits at the absolute top of page 1
  // content area, above Patient Information. The severity strip is still
  // drawn first so the PDF's severity line matches the AI verdict, then
  // the override callout dominates visually with its red callout box.
  if (emergencyOverride && emergencyOverride.triggered) {
    y = drawEmergencyOverrideBlock(doc, emergencyOverride, y);
  }

  // 0. REFERRAL PLAN (Step 23) — structured 5-tier plan from the Smart
  // Referral Directory. Renders between the override callout and Patient
  // Information. When the Emergency Override is active, getReferralRecommendation
  // forces this to the EMERGENCY tier, so the colored left rule matches
  // the red callout above it.
  if (referralPlan) {
    y = ensureSpace(doc, y, 4);
    y = drawReferralPlanBlock(doc, referralPlan, y);
  }

  // 1. PATIENT INFORMATION (Step 21)
  y = drawSectionTitle(doc, y, 'Patient Information');
  y = drawPatientInfoTable(doc, patientInfo, y);
  y = ensureSpace(doc, y, 4);

  // 2. PATIENT VITALS
  y = drawSectionTitle(doc, y, 'Patient Vitals');
  y = drawVitalsTable(doc, vitals, y);
  y = ensureSpace(doc, y, 4);

  // 3. ANOMALY FINDINGS
  y = drawSectionTitle(doc, y, 'Anomaly Findings');
  y = drawNumberedList(doc, alerts, y);
  y = ensureSpace(doc, y, 4);

  // 4. LAB FINDINGS  (only render if at least one row)
  y = drawLabFindingsTable(doc, labFindings, y);
  y = ensureSpace(doc, y, 4);

  // 5. LAB ALERTS    (only render if at least one alert)
  y = drawSectionTitle(doc, y, 'Lab Alerts');
  y = drawNumberedList(doc, labAlerts, y);

  // =====================================================================
  // PAGE 2 — sections 6..12
  // =====================================================================
  doc.addPage();
  drawHeader(doc, {
    severity: verdict.severity,
    reportId,
    generatedAt,
  });
  y = MARGIN_TOP + 6;

  // 6. CLINICAL SUMMARY
  y = drawSectionTitle(doc, y, 'Clinical Summary');
  y = drawWrappedText(
    doc,
    verdict.summary || 'No clinical summary provided.',
    MARGIN_X,
    y,
    { size: 10.5, lineHeight: 4.8 }
  );
  y = ensureSpace(doc, y, 4);

  // 7. POSSIBLE CONDITIONS
  y = drawSectionTitle(doc, y, 'Possible Conditions');
  y = drawNumberedList(doc, verdict.possible_conditions, y);
  y = ensureSpace(doc, y, 4);

  // 8. RECOMMENDED ACTIONS
  y = drawSectionTitle(doc, y, 'Recommended Actions');
  y = drawNumberedList(doc, verdict.recommended_actions, y);
  y = ensureSpace(doc, y, 4);

  // 9. FIRST AID RECOMMENDATIONS (English-only, no color accent)
  y = ensureSpace(doc, y, 8);
  y = drawFirstAidList(doc, firstAid, y);
  y = ensureSpace(doc, y, 4);

  // 10. REFERRAL RECOMMENDATION
  y = drawSectionTitle(doc, y, 'Referral Recommendation');
  y = drawWrappedText(
    doc,
    verdict.referral || 'No referral guidance provided.',
    MARGIN_X,
    y
  );
  y = ensureSpace(doc, y, 4);

  // 11. VOICE TRANSCRIPT  (monospace bordered block)
  y = drawMonoBlock(doc, 'Voice Transcript / Symptoms Notes', voiceTranscript, y);
  y = ensureSpace(doc, y, 4);

  // 12. OCR EXTRACTED TEXT (monospace bordered block)
  y = drawMonoBlock(doc, 'OCR Extracted Text', ocrText, y);

  // --- AI disclaimer rule (last-page footnote)
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

  // --- Page chrome (footer) on every page
  const totalPages = pageCount(doc);
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawPageChrome(doc, p);
  }

  // --- Filename + download
  const sev = (verdict.severity || 'LOW').toLowerCase();
  const stamp = generatedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `shuruksha-link-triage-${sev}-${stamp}.pdf`;

  doc.save(filename);
  return { filename, pageCount: totalPages };
}

export default generatePhysicianPdf;
