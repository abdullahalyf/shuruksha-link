// Shuruksha Link — Physician PDF report generator (Step 24 redesign)
//
// English-only, print-friendly clinical report styled after private-hospital
// diagnostic reports (Ibn Sina, Labaid, Square Hospital, Popular Diagnostic).
// Pure utility — turns the assembled triage payload into an A4 PDF via jsPDF.
// All medical logic lives elsewhere; this file is rendering only.
//
// ---------------------------------------------------------------------------
// Page 1
//   Header (every page)
//     Top-left  : SHURUKSHA LINK  /  AI-Assisted Rural Triage Report
//     Top-right : Report ID | Date | Time
//     Thin horizontal rule underneath.
//
//   Section 1. PATIENT INFORMATION         Name / Age / Gender / Phone / Address
//   Section 2. TRIAGE VERDICT              large bordered box:
//                                          severity badge + confidence +
//                                          summary paragraph
//   Section 3. EMERGENCY OVERRIDE          red-bordered alert (only when
//                                          emergencyOverride.triggered === true)
//                                          reasons, immediate first aid, referral
//   Section 4. REFERRAL PLAN               Facility / Urgency / Transport /
//                                          Recommendation / Transfer Checklist
//   Section 5. VITAL SIGNS                 Parameter | Value | Unit | Status
//                                          (pathology-report style, 4-column)
//   Section 6. ANOMALY FINDINGS            bullet list
//
// Page 2
//   Section 7.  LAB FINDINGS               Parameter | Value | Unit | Status
//   Section 8.  CLINICAL SUMMARY           paragraph
//   Section 9.  POSSIBLE CONDITIONS        numbered list
//   Section 10. FIRST AID RECOMMENDATIONS  ✓ checklist
//   Section 11. VOICE TRANSCRIPT           monospace bordered block
//   Section 12. OCR EXTRACT                monospace bordered block
//
//   Final-page section
//     AI DISCLAIMER — italic, 8.5pt, slate-600
//
// Footer (every page)
//   thin rule + "Shuruksha Link | Confidential Clinical Report | Page X of Y"
//
// ---------------------------------------------------------------------------
// Typography (Helvetica + Courier, English only — no Bengali in PDF)
//   Document title    : Helvetica-Bold 18pt
//   Section titles    : Helvetica-Bold 11pt, UPPERCASE, tracked, with hairline
//                       rule above and a 0.3mm section rule below
//   Body / paragraph  : Helvetica 9.5pt
//   Tables (data)     : Helvetica 9pt, labels Helvetica-Bold 8.5pt
//   Monospace         : Courier 9pt
//   Footnote / meta   : Helvetica 8pt
//
// Color usage — strict grayscale with FOUR tier accents, used SPARINGLY:
//   - Severity strip / verdict badge:  CRITICAL = dark red, HIGH = amber,
//                                      MEDIUM  = blue,   LOW   = green
//   - Status pills (vitals + lab):     same four colors
//   - Emergency Override block:        red rule + title bar only
//   - Referral Plan:                   thin 1.6 mm left rule tinted to tier
//   Everything else: black, dark gray, light gray borders — print-friendly.

import { jsPDF } from 'jspdf';

// --- A4 geometry ----------------------------------------------------------
const PAGE_W = 210;        // mm
const PAGE_H = 297;        // mm
const MARGIN_X = 18;
const MARGIN_TOP = 30;     // pushed down to clear the two-line header
const MARGIN_BOTTOM = 18;
const CONTENT_W = PAGE_W - MARGIN_X * 2; // 174 mm

// ── Defensive coercion helpers ────────────────────────────────────────────
// jsPDF's `text()` throws "Invalid arguments" when its first argument is
// not a primitive string/number. Gemini (and our own rule-based fallbacks)
// can occasionally hand us an object, array, null, or undefined where a
// string is expected. These two helpers guarantee safe primitives at every
// `doc.text(...)` boundary without altering any medical logic.
function safeText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(safeText).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    // Bilingual shapes like { en: '...', bn: '...' } — prefer the English key,
    // fall back to the first defined string property.
    if (typeof value.en === 'string') return value.en;
    if (typeof value.bn === 'string') return value.bn;
    for (const k of Object.keys(value)) {
      const v = value[k];
      if (typeof v === 'string' && v.length) return v;
    }
    return '';
  }
  return String(value);
}

// Coerce an array-shaped field (e.g. possible_conditions, recommended_actions,
// alerts, labAlerts) into a clean string[]. Accepts arrays, string scalars,
// and bilingual object arrays ({en, bn}).
function asStringList(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item == null) return '';
        if (typeof item === 'string') return item;
        if (typeof item === 'number' || typeof item === 'boolean') return String(item);
        if (typeof item === 'object') return safeText(item);
        return String(item);
      })
      .filter((s) => typeof s === 'string' && s.length > 0);
  }
  if (value == null) return [];
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (typeof value === 'object') {
    const flat = safeText(value);
    return flat ? [flat] : [];
  }
  return [String(value)];
}

// --- Color tokens (print-friendly) ---------------------------------------
// Color is reserved for the 4 severity tiers + matching status pills.
const COLOR = {
  ink:        [17, 24, 39],    // slate-900 — body text
  inkMuted:   [71, 85, 105],   // slate-600 — labels, meta
  inkFaint:   [148, 163, 184], // slate-400 — rules, placeholders
  rule:       [203, 213, 225], // slate-300 — table rules
  ruleStrong: [100, 116, 139], // slate-500 — emphasis rules
  bg:         [255, 255, 255], // white

  // Four severity accents (per Step 24 spec)
  // CRITICAL = dark red, HIGH = amber, MEDIUM = blue, LOW = green
  critical:   [159, 18, 57],   // rose-800 (CRITICAL/EMERGENCY)
  high:       [180, 83, 9],    // amber-700 (HIGH)
  medium:     [29, 78, 216],   // blue-700 (MEDIUM)
  low:        [5, 150, 105],   // emerald-600 (LOW)

  // Light wash for the Emergency Override callout body
  emergencyWash: [255, 241, 242], // rose-50
};

// --- Severity visual mapping ---------------------------------------------
const SEVERITY_PALETTE = {
  LOW:      { label: 'LOW',      rgb: COLOR.low,      rank: 1, word: 'Stable'    },
  MEDIUM:   { label: 'MEDIUM',   rgb: COLOR.medium,   rank: 2, word: 'Caution'   },
  HIGH:     { label: 'HIGH',     rgb: COLOR.high,     rank: 3, word: 'Urgent'    },
  CRITICAL: { label: 'CRITICAL', rgb: COLOR.critical, rank: 4, word: 'Emergency' },
};

// --- Vitals field metadata (must match VitalsForm.jsx) -------------------
const VITAL_FIELDS = [
  { key: 'bp',         label: 'Blood Pressure',          unit: 'mmHg',
    normal: (v) => {
      const m = String(v).match(/(\d{2,3})\s*\/\s*(\d{2,3})/);
      if (!m) return { status: 'UNKNOWN', text: '—' };
      const sys = +m[1], dia = +m[2];
      if (sys < 90 || sys >= 180 || dia < 60 || dia >= 120) return { status: 'CRITICAL', text: 'Critical' };
      if (sys < 100 || dia < 70) return { status: 'LOW', text: 'Low' };
      if (sys >= 140 || dia >= 90) return { status: 'HIGH', text: 'Elevated' };
      return { status: 'NORMAL', text: 'Normal' };
    },
  },
  { key: 'heartRate',  label: 'Heart Rate',              unit: 'bpm',
    normal: (v) => {
      const n = Number(v); if (!Number.isFinite(n)) return { status: 'UNKNOWN', text: '—' };
      if (n < 50 || n >= 130) return { status: 'CRITICAL', text: 'Critical' };
      if (n < 60 || n >= 110) return { status: 'ABNORMAL', text: 'Abnormal' };
      return { status: 'NORMAL', text: 'Normal' };
    },
  },
  { key: 'temperature', label: 'Temperature',             unit: '°C',
    normal: (v) => {
      const n = Number(v); if (!Number.isFinite(n)) return { status: 'UNKNOWN', text: '—' };
      if (n < 35 || n >= 40) return { status: 'CRITICAL', text: 'Critical' };
      if (n < 36.1 || n >= 38) return { status: 'ABNORMAL', text: 'Abnormal' };
      return { status: 'NORMAL', text: 'Normal' };
    },
  },
  { key: 'oxygen',     label: 'Oxygen Saturation (SpO2)', unit: '%',
    normal: (v) => {
      const n = Number(v); if (!Number.isFinite(n)) return { status: 'UNKNOWN', text: '—' };
      if (n < 90) return { status: 'CRITICAL', text: 'Critical' };
      if (n < 94) return { status: 'LOW', text: 'Low' };
      return { status: 'NORMAL', text: 'Normal' };
    },
  },
  { key: 'glucose',    label: 'Blood Glucose',           unit: 'mg/dL',
    normal: (v) => {
      const n = Number(v); if (!Number.isFinite(n)) return { status: 'UNKNOWN', text: '—' };
      if (n < 60 || n >= 250) return { status: 'CRITICAL', text: 'Critical' };
      if (n < 70 || n >= 180) return { status: 'ABNORMAL', text: 'Abnormal' };
      return { status: 'NORMAL', text: 'Normal' };
    },
  },
];

// --- Lab field metadata (must match parseMedicalReport.js) ---------------
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

function pageCount(doc) { return doc.getNumberOfPages(); }

// Module-level scratch for ensureSpace to re-draw the header on overflow.
// Set at the top of generatePhysicianPdf().
let currentReportState = { severity: 'LOW', reportId: '', generatedAt: null };

// Make sure `y` has at least `needed` mm before drawing. Adds a new page
// (with header) if the next block would overflow.
function ensureSpace(doc, y, needed) {
  const limit = PAGE_H - MARGIN_BOTTOM;
  if (y + needed > limit) {
    doc.addPage();
    drawPageHeader(doc, {
      severity: currentReportState.severity,
      reportId: currentReportState.reportId,
      generatedAt: currentReportState.generatedAt,
    });
    return MARGIN_TOP;
  }
  return y;
}

// --- HEADER (every page) -------------------------------------------------
// Top-left  : SHURUKSHA LINK (18pt bold) / AI-Assisted Rural Triage Report
// Top-right : Report ID / Date / Time
// Thin horizontal rule underneath.
function drawPageHeader(doc, { severity, reportId, generatedAt } = {}) {
  const topY = 16;

  // Top-left project name
  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('SHURUKSHA LINK', MARGIN_X, topY);

  // Subtitle
  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('AI-Assisted Rural Triage Report', MARGIN_X, topY + 5);

  // Top-right: Report ID / Date / Time
  const rightX = PAGE_W - MARGIN_X;
  const meta = metaFor(generatedAt || currentReportState.generatedAt, reportId);

  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text('Report ID', rightX, topY - 4, { align: 'right' });
  doc.text('Date',      rightX, topY,    { align: 'right' });
  doc.text('Time',      rightX, topY + 4, { align: 'right' });

  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(meta.reportId,   rightX, topY,    { align: 'right' });
  doc.text(meta.dateString, rightX, topY + 4, { align: 'right' });
  doc.text(meta.timeString, rightX, topY + 8, { align: 'right' });

  // Thin horizontal rule (slate-500, 0.3mm)
  setDraw(doc, COLOR.ruleStrong);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, topY + 11, PAGE_W - MARGIN_X, topY + 11);
}

function metaFor(generatedAt, reportId) {
  const now = generatedAt instanceof Date ? generatedAt : new Date();
  const dateString = now.toLocaleDateString('en-GB', {
    year: 'numeric', month: 'short', day: '2-digit',
  });
  const timeString = now.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return {
    dateString,
    timeString,
    reportId: reportId || `SL-${now.getTime()}`,
  };
}

// --- FOOTER (every page) -------------------------------------------------
// Thin rule + "Shuruksha Link | Confidential Clinical Report | Page X of Y"
function drawPageFooter(doc, { page, total } = {}) {
  const y = PAGE_H - 11;
  setDraw(doc, COLOR.rule);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);

  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  const resolvedTotal = Number.isFinite(total) ? total : pageCount(doc);
  const resolvedPage  = Number.isFinite(page)  ? page  : 1;
  doc.text('Shuruksha Link', MARGIN_X, y + 4);
  doc.text('Confidential Clinical Report', PAGE_W / 2, y + 4, { align: 'center' });
  doc.text(`Page ${resolvedPage} of ${resolvedTotal}`, PAGE_W - MARGIN_X, y + 4, { align: 'right' });
}
// --- SECTION TITLE -------------------------------------------------------
// Hairline rule above + 11pt bold UPPERCASE label + thin rule below.
// Returns the y-position for the first body line.
function drawSectionTitle(doc, y, text) {
  setDraw(doc, COLOR.rule);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, y - 1, MARGIN_X + CONTENT_W, y - 1);

  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(String(text).toUpperCase(), MARGIN_X, y + 4.5);

  // Underline section title with a thin slate-500 rule
  setDraw(doc, COLOR.ruleStrong);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, y + 6, MARGIN_X + CONTENT_W, y + 6);

  return y + 10;
}

// --- Wrapped paragraph text ----------------------------------------------
function drawWrappedText(doc, text, x, y, opts = {}) {
  const {
    maxWidth = CONTENT_W,
    font = 'helvetica',
    style = 'normal',
    size = 9.5,
    color = COLOR.ink,
    lineHeight = 4.4,
  } = opts;
  if (!text) return y;
  setText(doc, color);
  doc.setFont(font, style);
  doc.setFontSize(size);
  const lines = doc.splitTextToSize(String(text), maxWidth);
  doc.text(lines, x, y);
  return y + lines.length * lineHeight;
}

// --- Numbered list --------------------------------------------------------
function drawNumberedList(doc, items, y) {
  const safe = asStringList(items);
  if (safe.length === 0) {
    setText(doc, COLOR.inkFaint);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.text('None recorded.', MARGIN_X, y);
    return y + 5;
  }
  let cursor = y;
  safe.forEach((item, i) => {
    const lines = doc.splitTextToSize(String(item), CONTENT_W - 12);
    setText(doc, COLOR.inkMuted);
    doc.setFont('helvetica', 'bold');
    doc.text(`${i + 1}.`, MARGIN_X, cursor);
    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.text(lines, MARGIN_X + 8, cursor);
    cursor += lines.length * 4.4 + 1.4;
  });
  return cursor;
}

// --- Bullet list ----------------------------------------------------------
function drawBulletList(doc, items, y) {
  const safe = asStringList(items);
  if (safe.length === 0) {
    setText(doc, COLOR.inkFaint);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.text('None recorded.', MARGIN_X, y);
    return y + 5;
  }
  let cursor = y;
  safe.forEach((item) => {
    const lines = doc.splitTextToSize(String(item), CONTENT_W - 10);
    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text('â€¢', MARGIN_X, cursor);
    doc.text(lines, MARGIN_X + 5, cursor);
    cursor += lines.length * 4.4 + 1.2;
  });
  return cursor;
}

// --- Status pill (4-color, 22x5mm, rounded) ------------------------------
function drawStatusPill(doc, status, cx, cy) {
  const STATUS_PALETTE = {
    NORMAL:   { rgb: COLOR.low,      text: 'NORMAL'   },
    ABNORMAL: { rgb: COLOR.high,     text: 'ABNORMAL' },
    LOW:      { rgb: COLOR.medium,   text: 'LOW'      },
    HIGH:     { rgb: COLOR.high,     text: 'HIGH'     },
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

// --- Severity badge (full-width strip under the page header) -------------
// Renders a left-edge color rule, severity word, and confidence. Returns
// the y-position immediately below the strip.
function drawSeverityBadge(doc, severity, confidence) {
  const meta = SEVERITY_PALETTE[severity] || SEVERITY_PALETTE.LOW;
  const x = MARGIN_X;
  const y = MARGIN_TOP;
  const w = CONTENT_W;
  const h = 14;

  // Wash background
  setFill(doc, [255, 255, 255]);
  doc.rect(x, y, w, h, 'F');

  // Left color rule (severity color, 3mm)
  setFill(doc, meta.rgb);
  doc.rect(x, y, 3, h, 'F');

  // Severity word
  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('SEVERITY', x + 6, y + 5);

  setText(doc, meta.rgb);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(meta.label, x + 6, y + 11);

  // Right-aligned confidence
  const conf = (Number.isFinite(Number(confidence))
    ? Math.round(Number(confidence) * 100)
    : null);
  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('CONFIDENCE', x + w - 4, y + 5, { align: 'right' });

  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(
    conf == null ? '—' : `${conf}%`,
    x + w - 4, y + 11, { align: 'right' }
  );

  return y + h + 2;
}
// =========================================================================
// SECTION 1 — PATIENT INFORMATION (table, no section title rule above)
// =========================================================================
function drawPatientInfoTable(doc, patientInfo, y) {
  const pi = (patientInfo && typeof patientInfo === 'object') ? patientInfo : {};
  const rows = [
    { label: 'Patient Name', value: (pi.name    || '').toString().trim() },
    { label: 'Age',          value: Number.isFinite(Number(pi.age))
                                ? `${Number(pi.age)} years` : '' },
    { label: 'Gender',       value: (pi.gender  || '').toString().trim() },
    { label: 'Phone',        value: (pi.phone   || '').toString().trim() },
    { label: 'Address',      value: (pi.address || '').toString().trim() },
  ];

  const labelColW = 42;          // mm — fixed label column
  const valueColX = MARGIN_X + labelColW;
  const valueColW = CONTENT_W - labelColW;
  const rowH = 7.5;

  // Outer border (slate-900, 0.4mm) — clinical look
  setDraw(doc, COLOR.ink);
  doc.setLineWidth(0.4);
  doc.rect(MARGIN_X, y, CONTENT_W, rowH * rows.length);

  rows.forEach((r, i) => {
    const rowY = y + i * rowH;
    const textY = rowY + 5;

    // Vertical separator between label and value
    setDraw(doc, COLOR.rule);
    doc.setLineWidth(0.2);
    doc.line(valueColX, rowY, valueColX, rowY + rowH);

    // Label
    setText(doc, COLOR.inkMuted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(r.label, MARGIN_X + 2, textY);

    // Value (wrap if longer than column)
    const trimmed = (r.value || '').trim();
    if (trimmed) {
      setText(doc, COLOR.ink);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      const lines = doc.splitTextToSize(trimmed, valueColW - 4);
      doc.text(lines, valueColX + 2, textY);
    } else {
      setText(doc, COLOR.inkFaint);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9.5);
      doc.text('—', valueColX + 2, textY);
    }

    // Hairline between rows
    if (i < rows.length - 1) {
      setDraw(doc, COLOR.rule);
      doc.setLineWidth(0.1);
      doc.line(MARGIN_X, rowY + rowH, MARGIN_X + CONTENT_W, rowY + rowH);
    }
  });

  return y + rowH * rows.length + 4;
}

// =========================================================================
// SECTION 2 — TRIAGE VERDICT (large bordered box)
//   ┌──────────────────────────────────────────────────┐
//   │ TRIAGE VERDICT                                   │
//   │ ┌──────────────┐  Severity: CRITICAL — Emergency│
//   │ │  CRITICAL    │  Confidence: HIGH              │
//   │ └──────────────┘                                 │
//   │ ───────────────────────────────────────────────  │
//   │ Summary paragraph wrapping within the box…      │
//   └──────────────────────────────────────────────────┘
// =========================================================================
function drawTriageVerdictBox(doc, verdict, y) {
  const severity = verdict.severity || 'LOW';
  const confidence = (safeText(verdict.confidence) || '—').toUpperCase();
  const summary = (safeText(verdict.summary) || 'No clinical summary provided.').trim();

  // Pre-compute summary line count
  const innerX = MARGIN_X + 6;
  const innerW = CONTENT_W - 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const summaryLines = doc.splitTextToSize(summary, innerW - 50);
  const summaryH = summaryLines.length * 4.4;

  const headH = 14;  // badge row + descriptor + confidence
  const padTop = 6;
  const padBottom = 6;
  const totalH = padTop + headH + 4 + summaryH + padBottom;

  // Outer box (slate-900 border, 0.4mm, white fill)
  setDraw(doc, COLOR.ink);
  doc.setLineWidth(0.4);
  setFill(doc, COLOR.bg);
  doc.rect(MARGIN_X, y, CONTENT_W, totalH, 'FD');

  // Severity color swatch on the left (replaces in-box badge —
  // the page-level severity strip already shows the full word, so the
  // box gets a small color chip + the label text to the right).
  const sevMeta = SEVERITY_PALETTE[severity] || SEVERITY_PALETTE.LOW;
  setFill(doc, sevMeta.rgb);
  doc.roundedRect(innerX, y + padTop, 38, 11, 1.2, 1.2, 'F');
  setText(doc, [255, 255, 255]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(sevMeta.label, innerX + 19, y + padTop + 7.5, { align: 'center' });

  // Right of badge: severity descriptor + confidence
  const textX = innerX + 38 + 6;
  const sev = SEVERITY_PALETTE[severity] || SEVERITY_PALETTE.LOW;
  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Severity: ${sev.label} — ${sev.word}`, textX, y + padTop + 4);

  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Confidence: ${confidence}`, textX, y + padTop + 10);

  // Summary block (with thin top divider inside the box)
  const sumY = y + padTop + headH + 2;
  setDraw(doc, COLOR.rule);
  doc.setLineWidth(0.2);
  doc.line(innerX, sumY, innerX + innerW, sumY);

  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(summaryLines, innerX, sumY + 5);

  return y + totalH + 3;
}
// =========================================================================
// SECTION 3 — EMERGENCY OVERRIDE (red-bordered alert, only if triggered)
// =========================================================================
function drawEmergencyOverrideBlock(doc, override, y) {
  if (!override || !override.triggered) return y;
  const reasons = Array.isArray(override.reasons) ? override.reasons : [];
  const firstAid = Array.isArray(override.firstAid) ? override.firstAid : [];
  const referral = String(override.referral || '').trim();

  const innerX = MARGIN_X + 4;
  const innerW = CONTENT_W - 8;
  const titleH = 8;
  const reasonH = Math.max(reasons.length, 1) * 4.4;
  const faHeaderH = 6;
  const faItemH = Math.max(firstAid.length, 1) * 4.4;
  const refH = referral ? 9 : 0;
  const padTop = 4;
  const padBottom = 4;
  const totalH = padTop + titleH + reasonH + faHeaderH + faItemH + refH + padBottom;

  // Light rose-50 wash + 0.8mm red border
  setFill(doc, COLOR.emergencyWash);
  setDraw(doc, COLOR.critical);
  doc.setLineWidth(0.8);
  doc.rect(MARGIN_X, y, CONTENT_W, totalH, 'FD');

  // Title bar (solid red)
  setFill(doc, COLOR.critical);
  doc.rect(MARGIN_X, y, CONTENT_W, titleH, 'F');

  setText(doc, [255, 255, 255]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('EMERGENCY OVERRIDE', innerX, y + 5.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('CRITICAL — Life-threatening findings',
           MARGIN_X + CONTENT_W - 4, y + 5.5, { align: 'right' });

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
    cursor += 4.4;
  } else {
    reasons.forEach((r) => {
      const lines = doc.splitTextToSize(String(r), innerW - 6);
      doc.text('•', innerX, cursor);
      doc.text(lines, innerX + 4, cursor);
      cursor += lines.length * 4.2;
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
    cursor += 4.4;
  } else {
    firstAid.forEach((a) => {
      const lines = doc.splitTextToSize(String(a), innerW - 6);
      doc.text('•', innerX, cursor);
      doc.text(lines, innerX + 4, cursor);
      cursor += lines.length * 4.2;
    });
  }
  cursor += 2;

  // Referral (red strip at bottom of the callout)
  if (referral) {
    const refY = y + totalH - refH;
    setFill(doc, COLOR.critical);
    doc.rect(MARGIN_X, refY, CONTENT_W, refH, 'F');
    setText(doc, [255, 255, 255]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    const refLines = doc.splitTextToSize(referral, CONTENT_W - 8);
    doc.text(refLines, innerX, refY + 5.5);
  }

  return y + totalH + 3;
}

// =========================================================================
// SECTION 4 — REFERRAL PLAN
// Grayscale body with 1.6mm tier-tinted left rule + level badge text.
// =========================================================================
function drawReferralPlanBlock(doc, plan, y) {
  if (!plan || typeof plan !== 'object') return y;

  const level = String(plan.level || 'LOW').toUpperCase();
  const facilityType = String(plan.facilityType || '—').trim() || '—';
  const urgency = String(plan.urgency || '—').trim() || '—';
  const transportation = String(plan.transportation || '—').trim() || '—';
  const recommendation = String(plan.recommendation || '').trim();
  const checklist = Array.isArray(plan.checklist) ? plan.checklist : [];

  // Tier accent — only for left rule + level badge text
  const accent =
       level === 'EMERGENCY' || level === 'CRITICAL' ? COLOR.critical
    : level === 'HIGH'   ? COLOR.high
    : level === 'MEDIUM' ? COLOR.medium
    :                       COLOR.low;

  const innerX = MARGIN_X + 6;
  const innerW = CONTENT_W - 12;
  const stripH = 8;
  const metaRowH = 6;

  const recLines = recommendation
    ? doc.splitTextToSize(recommendation, innerW - 30)
    : [];
  const recH = recommendation ? (recLines.length * 4.4 + 6) : 0;
  const clHeaderH = checklist.length > 0 ? 6 : 0;
  const clItemH = checklist.length * 4.2;
  const padTop = 4;
  const padBottom = 4;
  const bodyH = stripH + metaRowH * 3 + recH + clHeaderH + clItemH;
  const totalH = padTop + bodyH + padBottom;

  // Light slate-50 wash + hairline border
  setFill(doc, [248, 250, 252]);
  setDraw(doc, COLOR.rule);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN_X, y, CONTENT_W, totalH, 'FD');

  // Thick left rule tinted to tier
  setFill(doc, accent);
  doc.rect(MARGIN_X, y, 1.6, totalH, 'F');

  let cursor = y + padTop;

  // Level strip
  setText(doc, accent);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('REFERRAL LEVEL', innerX, cursor + 3);

  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(level, innerX + 30, cursor + 3);
  cursor += stripH;

  // Meta rows
  const metaRows = [
    { label: 'Facility',  value: facilityType },
    { label: 'Urgency',   value: urgency },
    { label: 'Transport', value: transportation },
  ];
  metaRows.forEach((row) => {
    setText(doc, COLOR.inkMuted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(row.label, innerX, cursor + 4);

    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    const valLines = doc.splitTextToSize(String(row.value), innerW - 32);
    doc.text(valLines, innerX + 32, cursor + 4);
    cursor += Math.max(metaRowH, valLines.length * 4.2 + 1);
  });

  // Recommendation
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
    cursor += recLines.length * 4.4 + 2;
  }

  // Transfer checklist
  if (checklist.length > 0) {
    setText(doc, COLOR.inkMuted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('TRANSFER CHECKLIST', innerX, cursor);
    cursor += 4.4;

    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    checklist.forEach((item) => {
      const lines = doc.splitTextToSize(String(item), innerW - 6);
      doc.text('•', innerX, cursor);
      doc.text(lines, innerX + 4, cursor);
      cursor += lines.length * 4.2;
    });
  }

  return y + totalH + 3;
}
// =========================================================================
// SECTION 5 — VITAL SIGNS (pathology-style 4-column table)
// Parameter | Value | Unit | Status
// =========================================================================
function drawVitalsTable(doc, vitals, y) {
  const colX = [MARGIN_X, MARGIN_X + 80, MARGIN_X + 110, MARGIN_X + CONTENT_W];
  const rowH = 8;

  // Top rule (slate-900, 0.4mm)
  setDraw(doc, COLOR.ink);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_W, y);
  y += 5;

  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('PARAMETER', colX[0] + 2, y);
  doc.text('VALUE',     colX[1] + 2, y);
  doc.text('UNIT',      colX[2] + 2, y);
  doc.text('STATUS',    colX[3] - 2, y, { align: 'right' });
  y += 3;

  setDraw(doc, COLOR.rule);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_W, y);
  y += 4.5;

  VITAL_FIELDS.forEach((f) => {
    const raw = vitals?.[f.key];
    const hasValue = !(raw === '' || raw == null);
    const value = hasValue ? String(raw) : '—';
    const evalRes = hasValue ? f.normal(raw) : { status: 'UNKNOWN', text: '—' };

    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(f.label, colX[0] + 2, y);
    doc.setFont('helvetica', 'bold');
    doc.text(value, colX[1] + 2, y);
    doc.setFont('helvetica', 'normal');
    setText(doc, COLOR.inkMuted);
    doc.text(f.unit, colX[2] + 2, y);

    drawStatusPill(doc, evalRes.status, colX[3] - 12, y + 1);
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

// =========================================================================
// SECTION 7 — LAB FINDINGS (pathology-style 4-column table)
// =========================================================================
function drawLabFindingsTable(doc, labFindings, y) {
  if (!labFindings || typeof labFindings !== 'object') return y;
  const rows = LAB_FIELDS
    .map((f) => {
      const raw = labFindings[f.key];
      if (raw === '' || raw == null) return null;
      return {
        label:  f.label,
        value:  String(raw),
        unit:   f.unit,
        status: labFindings[`${f.key}_status`] || 'UNKNOWN',
      };
    })
    .filter(Boolean);
  if (rows.length === 0) return y;

  const colX = [MARGIN_X, MARGIN_X + 80, MARGIN_X + 110, MARGIN_X + CONTENT_W];
  const rowH = 8;

  setDraw(doc, COLOR.ink);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_W, y);
  y += 5;

  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('PARAMETER', colX[0] + 2, y);
  doc.text('VALUE',     colX[1] + 2, y);
  doc.text('UNIT',      colX[2] + 2, y);
  doc.text('STATUS',    colX[3] - 2, y, { align: 'right' });
  y += 3;

  setDraw(doc, COLOR.rule);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_W, y);
  y += 4.5;

  rows.forEach((r) => {
    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.text(r.label, colX[0] + 2, y);
    doc.setFont('helvetica', 'bold');
    doc.text(r.value, colX[1] + 2, y);
    doc.setFont('helvetica', 'normal');
    setText(doc, COLOR.inkMuted);
    doc.text(r.unit, colX[2] + 2, y);

    drawStatusPill(doc, r.status, colX[3] - 12, y + 1);
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
// =========================================================================
// SECTION 10 — FIRST AID RECOMMENDATIONS (English-only ✓ checklist)
// =========================================================================
function drawFirstAidList(doc, firstAid, y) {
  const items = Array.isArray(firstAid?.firstAidItems) ? firstAid.firstAidItems : [];
  if (items.length === 0) return y;

  let cursor = y;
  items.forEach((it) => {
    const text = (it && typeof it === 'object')
      ? (it.en || it.bn || '')
      : String(it || '');
    if (!text) return;
    const lines = doc.splitTextToSize(text, CONTENT_W - 14);
    const blockH = lines.length * 4.4 + 1.2;

    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('✓', MARGIN_X + 2, cursor);

    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(lines, MARGIN_X + 8, cursor);
    cursor += blockH;
  });
  return cursor + 2;
}

// =========================================================================
// SECTION 11 / 12 — Monospace bordered block (Voice + OCR)
// =========================================================================
function drawMonoBlock(doc, label, text, y) {
  y = drawSectionTitle(doc, y, label);
  const safeText = text && text.trim().length > 0 ? text.trim() : 'Not provided.';
  doc.setFont('courier', 'normal');
  doc.setFontSize(9);
  setText(doc, COLOR.ink);
  const lines = doc.splitTextToSize(safeText, CONTENT_W - 8);
  const blockH = lines.length * 4.4 + 6;

  setDraw(doc, COLOR.rule);
  doc.setLineWidth(0.3);
  doc.rect(MARGIN_X, y, CONTENT_W, blockH);

  doc.text(lines, MARGIN_X + 4, y + 5);
  return y + blockH + 3;
}

// =========================================================================
// FINAL-PAGE — AI Disclaimer (italic, slate-600)
// =========================================================================
function drawAiDisclaimer(doc, y) {
  // Thin top rule
  setDraw(doc, COLOR.rule);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, y, MARGIN_X + CONTENT_W, y);
  y += 5;

  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  doc.text(
    'AI Disclaimer — This report is generated using AI-assisted triage support and should not replace professional clinical judgment. Final diagnosis and treatment decisions remain the responsibility of licensed healthcare professionals.',
    MARGIN_X, y,
    { maxWidth: CONTENT_W, lineHeightFactor: 1.4 }
  );
  return y + 10;
}
// =========================================================================
// MAIN EXPORT — generatePhysicianPdf
// Hospital-Grade Physician PDF · Step 24 redesign
// Page 1: Header ▸ Severity ▸ Override ▸ Referral ▸ Patient ▸ Verdict ▸ Vitals ▸ Anomalies
// Page 2: Lab ▸ Summary ▸ Conditions ▸ Actions ▸ First Aid ▸ Voice ▸ OCR ▸ AI Disclaimer
// =========================================================================
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
  if (!verdict || !verdict.severity) {
    throw new Error('generatePhysicianPdf: verdict with severity is required.');
  }

  // ── Defensive normalization ────────────────────────────────────────────
  // The backend already normalizes most fields, but rule-based fallbacks
  // (TriageResult.jsx local computation) and any older cached payloads can
  // still hand us non-primitive shapes. Coerce every user-derived input
  // here so that every downstream draw* call is guaranteed safe primitives.
  const safeVerdict = {
    severity: String(verdict.severity || 'LOW').toUpperCase(),
    confidence: safeText(verdict.confidence),
    summary: safeText(verdict.summary),
    possible_conditions: asStringList(verdict.possible_conditions),
    recommended_actions: asStringList(verdict.recommended_actions),
    referral: safeText(verdict.referral),
  };
  const safeAlerts = asStringList(alerts);
  const safeLabAlerts = asStringList(labAlerts);
  const safeVoiceTranscript = safeText(voiceTranscript);
  const safeOcrText = safeText(ocrText);

  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const generatedAt = new Date();
  const reportId = `SL-${generatedAt.getTime()}`;

  // Persist page-level meta so ensureSpace can redraw the header on overflow
  currentReportState.severity = verdict.severity;
  currentReportState.reportId = reportId;
  currentReportState.generatedAt = generatedAt;

  // ---------------------- PAGE 1 HEADER ----------------------
  drawPageHeader(doc, { severity: safeVerdict.severity, reportId, generatedAt });

  // ---------------------- SEVERITY STRIP ---------------------
  let y = drawSeverityBadge(doc, safeVerdict.severity, safeVerdict.confidence);

  // ---- 1. EMERGENCY OVERRIDE (always at the top of clinical content) ----
  if (emergencyOverride && emergencyOverride.triggered) {
    // Normalize the override's nested arrays/text in-place to safe primitives.
    const safeOverride = {
      ...emergencyOverride,
      reasons: asStringList(emergencyOverride.reasons),
      firstAid: asStringList(emergencyOverride.firstAid),
      referral: safeText(emergencyOverride.referral),
    };
    y = drawEmergencyOverrideBlock(doc, safeOverride, y);
  }

  // ---- 2. REFERRAL PLAN (Step 23) -------------------------------------
  if (referralPlan) {
    const safePlan = {
      level: String(referralPlan.level || 'LOW').toUpperCase(),
      facilityType: safeText(referralPlan.facilityType),
      urgency: safeText(referralPlan.urgency),
      transportation: safeText(referralPlan.transportation),
      recommendation: safeText(referralPlan.recommendation),
      checklist: asStringList(referralPlan.checklist),
    };
    y = drawReferralPlanBlock(doc, safePlan, y);
  }

  // ---- 3. PATIENT INFORMATION -----------------------------------------
  y = drawSectionTitle(doc, y, 'Patient Information');
  y = drawPatientInfoTable(doc, patientInfo, y);
  y += 4;

  // ---- 4. TRIAGE VERDICT BOX (severity-colored accent) ----------------
  y = drawTriageVerdictBox(doc, safeVerdict, y);
  y += 4;

  // ---- 5. PATIENT VITALS (4-column pathology-style) -------------------
  y = drawSectionTitle(doc, y, 'Patient Vitals');
  y = drawVitalsTable(doc, vitals, y);
  y += 4;

  // ---- 6. ANOMALY FINDINGS --------------------------------------------
  y = drawSectionTitle(doc, y, 'Anomaly Findings');
  y = drawNumberedList(doc, safeAlerts, y);
  y += 4;

  // ---------------------- PAGE 2 HEADER ----------------------
  doc.addPage();
  drawPageHeader(doc, { severity: safeVerdict.severity, reportId, generatedAt });
  y = 30 + 6;

  // ---- 7. LAB FINDINGS ------------------------------------------------
  y = drawSectionTitle(doc, y, 'Laboratory Findings');
  y = drawLabFindingsTable(doc, labFindings, y);
  y += 4;

  // ---- 7b. LAB ALERTS (only if present) -------------------------------
  if (safeLabAlerts.length > 0) {
    y = drawSectionTitle(doc, y, 'Lab Alerts');
    y = drawNumberedList(doc, safeLabAlerts, y);
    y += 4;
  }

  // ---- 8. CLINICAL SUMMARY --------------------------------------------      
  y = drawSectionTitle(doc, y, 'Clinical Summary');
  // drawWrappedText signature: (doc, text, x, y, opts).
  // The previous call passed `y` as the 3rd arg, which made the
  // `opts` object land in the `y` slot of `doc.text(lines, x, y)` and
  // throw "Invalid arguments passed to jsPDF.text". Pass MARGIN_X as
  // the x-coordinate so body text aligns with the section content.
  y = drawWrappedText(doc, safeVerdict.summary || 'No clinical summary provided.', MARGIN_X, y, { fontSize: 9.5, lineHeight: 4.8 });
  y += 4;

  // ---- 9. POSSIBLE CONDITIONS -----------------------------------------
  y = drawSectionTitle(doc, y, 'Possible Conditions');
  y = drawNumberedList(doc, safeVerdict.possible_conditions, y);
  y += 4;

  // ---- 10. RECOMMENDED ACTIONS ----------------------------------------
  y = drawSectionTitle(doc, y, 'Recommended Actions');
  y = drawNumberedList(doc, safeVerdict.recommended_actions, y);
  y += 4;

  // ---- 11. FIRST AID RECOMMENDATIONS (English-only) -------------------
  if (firstAid && Array.isArray(firstAid.firstAidItems) && firstAid.firstAidItems.length > 0) {
    y = drawSectionTitle(doc, y, 'First Aid Recommendations');
    y = drawFirstAidList(doc, firstAid, y);
    y += 4;
  }

  // ---- 12. REFERRAL RECOMMENDATION (free text) ------------------------      
  y = drawSectionTitle(doc, y, 'Referral Recommendation');
  // drawWrappedText signature: (doc, text, x, y, opts) — pass MARGIN_X
  // explicitly. (See fix in section 8 — same root cause: missing x arg.)
  y = drawWrappedText(doc, safeVerdict.referral || 'No referral guidance provided.', MARGIN_X, y);
  y += 4;

  // ---- 13. VOICE TRANSCRIPT (monospace block) -------------------------
  y = drawMonoBlock(doc, 'Voice Transcript / Symptoms Notes', safeVoiceTranscript, y);
  y += 2;

  // ---- 14. OCR EXTRACTED TEXT (monospace block) -----------------------
  y = drawMonoBlock(doc, 'OCR Extracted Text', safeOcrText, y);

  // ---- 15. AI DISCLAIMER (italic footnote) ----------------------------
  y = drawAiDisclaimer(doc, y + 4);

  // ---------------------- PAGE FOOTERS -----------------------
  const total = pageCount(doc);
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    drawPageFooter(doc, { page: p, total });
  }

  // ---------------------- SAVE FILE ----------------------------
  const safeName = (patientInfo?.name || 'patient')
    .toString()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 32) || 'patient';
  const filename = `Shuruksha_Link_Report_${safeName}_${reportId}.pdf`;
  doc.save(filename);

  return { filename, pageCount: total };
}

export default generatePhysicianPdf;
