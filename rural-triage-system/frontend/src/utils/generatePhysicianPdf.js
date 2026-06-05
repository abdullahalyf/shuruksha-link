// Shuruksha Link - Physician PDF report generator (Step 24 redesign)
//
// English-only, print-friendly clinical report styled after private-hospital
// diagnostic reports (Ibn Sina, Labaid, Square Hospital, Popular Diagnostic).
// Pure utility - turns the assembled triage payload into an A4 PDF via jsPDF.
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
//   Section 10. FIRST AID RECOMMENDATIONS  + checklist
//   Section 11. VOICE TRANSCRIPT           monospace bordered block
//   Section 12. OCR EXTRACT                monospace bordered block
//
//   Final-page section
//     AI DISCLAIMER - italic, 8.5pt, slate-600
//
// Footer (every page)
//   thin rule + "Shuruksha Link | Confidential Clinical Report | Page X of Y"
//
// ---------------------------------------------------------------------------
// Typography (Helvetica + Courier, English only - no Bengali in PDF)
//   Document title    : Helvetica-Bold 18pt
//   Section titles    : Helvetica-Bold 11pt, UPPERCASE, tracked, with hairline
//                       rule above and a 0.3mm section rule below
//   Body / paragraph  : Helvetica 9.5pt
//   Tables (data)     : Helvetica 9pt, labels Helvetica-Bold 8.5pt
//   Monospace         : Courier 9pt
//   Footnote / meta   : Helvetica 8pt
//
// Color usage - strict grayscale with FOUR tier accents, used SPARINGLY:
//   - Severity strip / verdict badge:  CRITICAL = dark red, HIGH = amber,
//                                      MEDIUM  = blue,   LOW   = green
//   - Status pills (vitals + lab):     same four colors
//   - Emergency Override block:        red rule + title bar only
//   - Referral Plan:                   thin 1.6 mm left rule tinted to tier
//   Everything else: black, dark gray, light gray borders - print-friendly.

import { jsPDF } from 'jspdf';

// --- A4 geometry (Step 24.3 - strict A4) ---------------------------------
// A4 portrait only. Margins, header band, and footer band are reserved
// globally so that no body content can ever paint over the header/footer.
// Step 24.3 - tighten the header band to 18mm and the footer band to
// 10mm (was 20/12 in Step 24.2). The tighter bands give 12mm more
// vertical room for clinical content while still leaving a 14mm
// bottom margin and a 4mm gap between the last body line and the
// footer rule. The body's effective bottom limit is
// PAGE_H - MARGIN_BOTTOM - FOOTER_HEIGHT = 297 - 14 - 10 = 273mm.
const PAGE_W = 210;        // mm
const PAGE_H = 297;        // mm
const LEFT_MARGIN = 14;    // mm
const RIGHT_MARGIN = 14;   // mm
const MARGIN_X = LEFT_MARGIN; // legacy alias used by helpers
const TOP_MARGIN = 12;     // body content starts here
const MARGIN_TOP = TOP_MARGIN; // legacy alias used by helpers
const BOTTOM_MARGIN = 14;  // body content stops here
const MARGIN_BOTTOM = BOTTOM_MARGIN; // legacy alias used by helpers
// Step 24.3 - explicit header / footer reserved bands (matches the
// "Header and footer heights must be reserved globally" requirement).
// The header itself is drawn inside the top 18mm; the body starts at
// MARGIN_TOP + HEADER_HEIGHT (12 + 18 = 30mm) so the header can never
// collide with the first section title. The footer occupies the
// bottom 10mm and is drawn at PAGE_H - FOOTER_HEIGHT; the body's
// effective bottom limit is PAGE_H - MARGIN_BOTTOM - FOOTER_HEIGHT
// (273mm) so that no card, table row, or text line can ever render
// into the footer band.
const HEADER_HEIGHT = 18;
const FOOTER_HEIGHT = 10;
const CONTENT_LIMIT = PAGE_H - MARGIN_BOTTOM - FOOTER_HEIGHT; // 273 mm
// Body content's first-line y on any new page (top of first section title).
const BODY_TOP = MARGIN_TOP + HEADER_HEIGHT; // 30 mm
const CONTENT_W = PAGE_W - MARGIN_X * 2;     // 182 mm

// Single source of truth for the bottom edge of body content. All
// page-break decisions go through this constant so the footer reservation
// stays consistent across ensureSpace(), atomic-block checks, table
// rendering, and the monospace transcript/OCR blocks.
function contentLimit() { return CONTENT_LIMIT; }
function bodyTop()      { return BODY_TOP; }

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
    // Bilingual shapes like { en: '...', bn: '...' } - prefer the English key,
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

// ── Step 24.3 - English-only text normalization for PDF rendering ────────
//
// jsPDF's default Helvetica family only supports the WinAnsi encoding -
// any non-ASCII (Bengali, Devanagari, Arabic, Chinese, emoji, smart
// quotes, em-dash, bullet, etc.) renders as mojibake or a black box.
// Voice transcripts and OCR text in the Shuruksha Link workflow arrive
// almost exclusively in Bengali (U+0980-U+09FF), so the contract is:
//
//   1. every piece of text that flows into doc.text() MUST be ASCII-safe;
//   2. if the source contains Bengali, the PDF shows an English
//      placeholder, never the original Bengali glyphs;
//   3. em-dash, bullet, middle-dot, smart quotes and similar WinAnsi-
//      only-by-luck glyphs are normalized to ASCII equivalents.
//
// These helpers are the ONLY way to coerce user-supplied strings into
// PDF-safe text. They never touch medical logic.

const BENGALI_REGEX = /[\u0980-\u09FF]/;
// Matches common "soft" punctuation that WinAnsi cannot represent
// reliably across PDF viewers.
const FANCY_PUNCT_REGEX = /[\u2010-\u2015\u2018-\u201F\u2022\u2026\u2027\u2032\u2033]/g;
// Matches any non-printable / control character (C0 + C1).
const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F-\u009F]/g;
// Matches any character outside printable ASCII (after we have already
// handled Bengali and fancy punctuation separately).
const NON_ASCII_REGEX = /[^\x20-\x7E]/g;

function toPdfText(value, opts = {}) {
  const { allowBengali = false, placeholder = '-' } = opts;
  const raw = safeText(value);
  if (!raw) return '';

  // If Bengali (or any non-Latin) script is present, never render it.
  // jsPDF's Helvetica has no Bengali glyphs and will print "?" boxes
  // or skip the character entirely - both unacceptable for a clinical
  // report. We either drop the whole string (placeholder) or strip the
  // non-ASCII portion if `allowBengali` is true (used as a last-ditch
  // fallback to keep line length consistent).
  const hasBengali = BENGALI_REGEX.test(raw);
  if (hasBengali) {
    if (!allowBengali) return placeholder;
    // allowBengali: keep the ASCII parts (typically numbers, punctuation,
    // "BP 120/80" inside a Bengali sentence) and drop the rest. This is
    // a degraded mode and is logged once per call.
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('[generatePhysicianPdf] Bengali characters stripped from text', {
        sample: raw.slice(0, 60),
      });
    }
    return raw
      .replace(BENGALI_REGEX, '')
      .replace(FANCY_PUNCT_REGEX, '-')
      .replace(CONTROL_CHARS_REGEX, '')
      .replace(NON_ASCII_REGEX, '')
      .replace(/\s+/g, ' ')
      .trim() || placeholder;
  }

  return raw
    .replace(/[\u2014\u2013]/g, '-')    // em-dash / en-dash -> ASCII '-'
    .replace(/[\u2022\u00B7\u2027]/g, '-') // bullet / middle-dot -> '-'
    .replace(FANCY_PUNCT_REGEX, '-')
    .replace(/'/g, "'")                  // curly single quotes
    .replace(/"/g, '"')                  // curly double quotes
    .replace(/\u00A0/g, ' ')             // non-breaking space
    .replace(CONTROL_CHARS_REGEX, '')
    .replace(NON_ASCII_REGEX, '')         // any remaining non-ASCII -> ''
    .replace(/[ \t]{2,}/g, ' ')          // collapse runs of spaces
    .replace(/[ ]+\n/g, '\n')            // trim trailing spaces per line
    .replace(/\n{3,}/g, '\n\n')          // collapse blank-line runs
    .trim();
}

function containsBengali(value) {
  return BENGALI_REGEX.test(safeText(value));
}

// Voice transcripts arrive via Web Speech API in Bengali in production.
// We render an English placeholder so the PDF never carries broken
// glyphs. The placeholder wording intentionally explains that an
// English summary is pending - physicians know to look at the original
// (case-history) record.
const VOICE_TRANSCRIPT_BENGALI_PLACEHOLDER =
  'Voice transcript captured in Bengali. English summary pending.';

const OCR_TEXT_BENGALI_PLACEHOLDER =
  'OCR text captured in Bengali. English summary pending.';

function normalizeTranscriptForPdf(value) {
  if (containsBengali(value)) {
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('[generatePhysicianPdf] Bengali voice transcript -> placeholder');
    }
    return VOICE_TRANSCRIPT_BENGALI_PLACEHOLDER;
  }
  return toPdfText(value, { placeholder: '' });
}

function normalizeOcrForPdf(value) {
  if (containsBengali(value)) {
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('[generatePhysicianPdf] Bengali OCR text -> placeholder');
    }
    return OCR_TEXT_BENGALI_PLACEHOLDER;
  }
  return toPdfText(value, { placeholder: '' });
}

// --- Color tokens (print-friendly) ---------------------------------------
// Color is reserved for the 4 severity tiers + matching status pills.
const COLOR = {
  ink:        [17, 24, 39],    // slate-900 - body text
  inkMuted:   [71, 85, 105],   // slate-600 - labels, meta
  inkFaint:   [148, 163, 184], // slate-400 - rules, placeholders
  rule:       [203, 213, 225], // slate-300 - table rules
  ruleStrong: [100, 116, 139], // slate-500 - emphasis rules
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
      if (!m) return { status: 'UNKNOWN', text: '-' };
      const sys = +m[1], dia = +m[2];
      if (sys < 90 || sys >= 180 || dia < 60 || dia >= 120) return { status: 'CRITICAL', text: 'Critical' };
      if (sys < 100 || dia < 70) return { status: 'LOW', text: 'Low' };
      if (sys >= 140 || dia >= 90) return { status: 'HIGH', text: 'Elevated' };
      return { status: 'NORMAL', text: 'Normal' };
    },
  },
  { key: 'heartRate',  label: 'Heart Rate',              unit: 'bpm',
    normal: (v) => {
      const n = Number(v); if (!Number.isFinite(n)) return { status: 'UNKNOWN', text: '-' };
      if (n < 50 || n >= 130) return { status: 'CRITICAL', text: 'Critical' };
      if (n < 60 || n >= 110) return { status: 'ABNORMAL', text: 'Abnormal' };
      return { status: 'NORMAL', text: 'Normal' };
    },
  },
  { key: 'temperature', label: 'Temperature',             unit: '°C',
    normal: (v) => {
      const n = Number(v); if (!Number.isFinite(n)) return { status: 'UNKNOWN', text: '-' };
      if (n < 35 || n >= 40) return { status: 'CRITICAL', text: 'Critical' };
      if (n < 36.1 || n >= 38) return { status: 'ABNORMAL', text: 'Abnormal' };
      return { status: 'NORMAL', text: 'Normal' };
    },
  },
  { key: 'oxygen',     label: 'Oxygen Saturation (SpO2)', unit: '%',
    normal: (v) => {
      const n = Number(v); if (!Number.isFinite(n)) return { status: 'UNKNOWN', text: '-' };
      if (n < 90) return { status: 'CRITICAL', text: 'Critical' };
      if (n < 94) return { status: 'LOW', text: 'Low' };
      return { status: 'NORMAL', text: 'Normal' };
    },
  },
  { key: 'glucose',    label: 'Blood Glucose',           unit: 'mg/dL',
    normal: (v) => {
      const n = Number(v); if (!Number.isFinite(n)) return { status: 'UNKNOWN', text: '-' };
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
// (with header) if the next block would overflow. The break threshold is
// `contentLimit()` (PAGE_H - MARGIN_BOTTOM - FOOTER_HEIGHT) so the footer
// band is always kept clear - content can never paint over "Page X of Y".
function ensureSpace(doc, y, needed) {
  const limit = contentLimit();
  if (y + needed > limit) {
    doc.addPage();
    drawPageHeader(doc, {
      severity: currentReportState.severity,
      reportId: currentReportState.reportId,
      generatedAt: currentReportState.generatedAt,
    });
    return bodyTop();
  }
  return y;
}

// Step 24.2 - atomic block pagination. Cards / callouts that must never
// be split across pages (Emergency Override, Referral Plan, Triage
// Verdict, Patient Information table, Lab Findings section header band,
// Voice Transcript, OCR Text, AI Disclaimer) call this with the block's
// pre-measured height. If the block doesn't fit on the current page,
// we add a new page, draw the header AND footer immediately (so the new
// page is fully skinned), then call `renderFn(y)` with the fresh y.
// `renderFn` is expected to return the y-position *after* the block.
function withAtomicBlock(doc, y, height, renderFn) {
  const limit = contentLimit();
  if (y + height > limit) {
    doc.addPage();
    drawPageHeader(doc, {
      severity: currentReportState.severity,
      reportId: currentReportState.reportId,
      generatedAt: currentReportState.generatedAt,
    });
    // Provisional footer (total is still 1; the final pass overwrites
    // this with the resolved total at the end of generatePhysicianPdf).
    const provisionalTotal = Math.max(pageCount(doc), 1);
    drawPageFooter(doc, { page: pageCount(doc), total: provisionalTotal });
    y = bodyTop();
  }
  return renderFn(y);
}

// --- HEADER (every page) -------------------------------------------------
// Step 24.3 - strict A4 header. Top-left title block + top-right 3-row
// metadata grid, all fitted inside the 18mm reserved header band.
//
// Layout (right-side box, all right-aligned, equal row pitch):
//   ┌────────────────┐
//   │ REPORT ID      │   <- 6.5pt slate-500 label
//   │ SL-178606...   │   <- 8pt Helvetica-Bold slate-900 value
//   │ DATE           │
//   │ 05 Jun 2026    │
//   │ TIME           │
//   │ 17:54          │
//   └────────────────┘
//
// Geometry: 3 rows, each = label (~2.5mm) + value (~3mm) ~= 5.5mm per
// row, so the total stack is ~16.5mm and lives well inside the 18mm
// header band. The horizontal rule sits at MARGIN_TOP + HEADER_HEIGHT,
// i.e. y=18, so it is always the last thing drawn in the header.
// Body content begins at BODY_TOP = 30mm, leaving a 12mm gap below the
// rule - no overlap is possible.
function drawHeader(doc, meta = {}) {
  const { severity, reportId, generatedAt } = meta;
  const titleY = MARGIN_TOP + 6; // baseline of the 18pt title

  // Top-left project name (18pt bold)
  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('SHURUKSHA LINK', MARGIN_X, titleY);

  // Subtitle (9pt normal, slate-600)
  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('AI-Assisted Rural Triage Report', MARGIN_X, titleY + 5);

  // Top-right 3-row metadata grid (right-aligned, never overlaps title).
  const rightX = PAGE_W - MARGIN_X;
  const gridTopY = MARGIN_TOP + 1;     // first label's baseline (y=13)
  const rowPitch = 5.5;                 // mm between successive rows
  const resolved = metaFor(generatedAt || currentReportState.generatedAt, reportId);

  // Row 1: Report ID
  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text('REPORT ID', rightX, gridTopY, { align: 'right' });
  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(resolved.reportId, rightX, gridTopY + 2.6, { align: 'right' });

  // Row 2: Date
  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text('DATE', rightX, gridTopY + rowPitch, { align: 'right' });
  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(resolved.dateString, rightX, gridTopY + rowPitch + 2.6, { align: 'right' });

  // Row 3: Time
  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text('TIME', rightX, gridTopY + rowPitch * 2, { align: 'right' });
  setText(doc, COLOR.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(resolved.timeString, rightX, gridTopY + rowPitch * 2 + 2.6, { align: 'right' });

  // Thin horizontal rule at the bottom of the 18mm header band.
  setDraw(doc, COLOR.ruleStrong);
  doc.setLineWidth(0.3);
  doc.line(
    MARGIN_X,
    MARGIN_TOP + HEADER_HEIGHT,
    PAGE_W - MARGIN_X,
    MARGIN_TOP + HEADER_HEIGHT
  );
}

// Step 24.3 - backward-compatible alias for callers that still use the
// Step 24.2 name. Routes everything through the new `drawHeader`.
function drawPageHeader(doc, meta = {}) {
  return drawHeader(doc, meta);
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
    reportId: toPdfText(reportId || `SL-${now.getTime()}`),
  };
}

// --- FOOTER (every page) -------------------------------------------------
// Step 24.3 - strict A4 footer. Thin rule + 3-column baseline at
// PAGE_H - FOOTER_HEIGHT + 2 (= 289mm). The rule itself sits at
// PAGE_H - FOOTER_HEIGHT (= 287mm), giving a 1mm gap to the body and
// an 8mm band for the three text columns.
function drawFooter(doc, pageNumber, totalPages) {
  const ruleY = PAGE_H - FOOTER_HEIGHT; // 287mm
  const textY = ruleY + 4;              // 291mm (baseline)

  setDraw(doc, COLOR.rule);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, ruleY, PAGE_W - MARGIN_X, ruleY);

  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);

  const resolvedPage  = Number.isFinite(pageNumber) ? pageNumber : 1;
  const resolvedTotal = Number.isFinite(totalPages) ? totalPages : pageCount(doc);
  doc.text('Shuruksha Link', MARGIN_X, textY);
  doc.text('Confidential Clinical Report', PAGE_W / 2, textY, { align: 'center' });
  doc.text(
    `Page ${resolvedPage} of ${resolvedTotal}`,
    PAGE_W - MARGIN_X,
    textY,
    { align: 'right' }
  );
}

// Step 24.3 - backward-compatible alias. Resolves page/total from
// the supplied object (legacy shape) or from positional args.
function drawPageFooter(doc, payload = {}) {
  if (typeof payload === 'object' && payload !== null) {
    return drawFooter(doc, payload.page, payload.total);
  }
  return drawFooter(doc, payload, arguments[2]);
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
    // ASCII-only bullet: jsPDF's Helvetica font only supports WinAnsi, so
    // a real - (U+2022) shows up as mojibake. "-" is safe everywhere.
    doc.text('-', MARGIN_X, cursor);
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
    UNKNOWN:  { rgb: COLOR.inkFaint, text: '-'        },
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
    conf == null ? '-' : `${conf}%`,
    x + w - 4, y + 11, { align: 'right' }
  );

  return y + h + 2;
}
// =========================================================================
// SECTION 1 - PATIENT INFORMATION (table, no section title rule above)
// =========================================================================
// Step 24.2 - pure measure for the Patient Information table.
// Wraps the value column to compute the height each row will need so
// the whole table can be moved to the next page as one unit.
function measurePatientInfoTableHeight(doc, patientInfo) {
  const pi = (patientInfo && typeof patientInfo === 'object') ? patientInfo : {};
  const rows = [
    { label: 'Patient Name', value: (pi.name    || '').toString().trim() },
    { label: 'Age',          value: Number.isFinite(Number(pi.age))
                                ? `${Number(pi.age)} years` : '' },
    { label: 'Gender',       value: (pi.gender  || '').toString().trim() },
    { label: 'Phone',        value: (pi.phone   || '').toString().trim() },
    { label: 'Address',      value: (pi.address || '').toString().trim() },
  ];
  const labelColW = 42;
  const valueColW = CONTENT_W - labelColW;
  const baseRowH = 7.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  let totalH = 0;
  rows.forEach((r) => {
    if (!r.value) {
      totalH += baseRowH;
      return;
    }
    const lines = doc.splitTextToSize(r.value, valueColW - 4);
    const textH = lines.length * 4.2 + 2;
    totalH += Math.max(baseRowH, textH + 2);
  });
  return totalH + 4; // +4 tail gap matches draw()
}

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

  const labelColW = 42;          // mm - fixed label column
  const valueColX = MARGIN_X + labelColW;
  const valueColW = CONTENT_W - labelColW;
  const rowH = 7.5;

  // Outer border (slate-900, 0.4mm) - clinical look
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
      doc.text('-', valueColX + 2, textY);
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
// SECTION 2 - TRIAGE VERDICT (large bordered box)
//   ┌──────────────────────────────────────────────────┐
//   │ TRIAGE VERDICT                                   │
//   │ ┌──────────────┐  Severity: CRITICAL - Emergency│
//   │ │  CRITICAL    │  Confidence: HIGH              │
//   │ └──────────────┘                                 │
//   │ ───────────────────────────────────────────────  │
//   │ Summary paragraph wrapping within the box.      │
//   └──────────────────────────────────────────────────┘
// Step 24.2 - split into a pure `measureTriageVerdictBoxHeight` (no
// side effects) + the existing draw routine. The measure function is
// what `withAtomicBlock` consumes so the entire card either fits whole
// on the current page or moves to the next page; the card is never
// split across pages.
// =========================================================================
function measureTriageVerdictBoxHeight(doc, verdict) {
  const summary = (safeText(verdict?.summary) || 'No clinical summary provided.').trim();
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const innerW = CONTENT_W - 12;
  const summaryLines = doc.splitTextToSize(summary, innerW - 50);
  const summaryH = summaryLines.length * 4.4;
  const headH = 14;
  const padTop = 6;
  const padBottom = 6;
  return padTop + headH + 4 + summaryH + padBottom + 3; // +3 tail gap
}

// Step 24.2 - pure measure for the Emergency Override callout.
// Returns the height (mm) the block will occupy, without drawing.
// Used by `withAtomicBlock` to decide whether the block fits on the
// current page.
function measureEmergencyOverrideBlockHeight(doc, override) {
  if (!override || !override.triggered) return 0;
  const reasons = Array.isArray(override.reasons) ? override.reasons : [];
  const firstAid = Array.isArray(override.firstAid) ? override.firstAid : [];
  const referral = String(override.referral || '').trim();

  const innerW = CONTENT_W - 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  let reasonH = 0;
  if (reasons.length === 0) {
    reasonH = 4.4;
  } else {
    reasons.forEach((r) => {
      const lines = doc.splitTextToSize(String(r), innerW - 6);
      reasonH += lines.length * 4.2;
    });
  }
  let faItemH = 0;
  if (firstAid.length === 0) {
    faItemH = 4.4;
  } else {
    firstAid.forEach((a) => {
      const lines = doc.splitTextToSize(String(a), innerW - 6);
      faItemH += lines.length * 4.2;
    });
  }
  const refH = referral
    ? doc.splitTextToSize(referral, CONTENT_W - 8).length * 4.4 + 2
    : 0;
  const titleH = 8;
  const faHeaderH = 6;
  const padTop = 4;
  const padBottom = 4;
  return padTop + titleH + reasonH + 2 + faHeaderH + faItemH + 2 + refH + padBottom + 3;
}

// Step 24.2 - pure measure for the Referral Plan block.
function measureReferralPlanBlockHeight(doc, plan) {
  if (!plan || typeof plan !== 'object') return 0;
  const recommendation = String(plan.recommendation || '').trim();
  const checklist = Array.isArray(plan.checklist) ? plan.checklist : [];
  const facilityType = String(plan.facilityType || '-').trim() || '-';
  const urgency = String(plan.urgency || '-').trim() || '-';
  const transportation = String(plan.transportation || '-').trim() || '-';

  const innerW = CONTENT_W - 12;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const metaRows = [facilityType, urgency, transportation];
  let metaH = 0;
  metaRows.forEach((v) => {
    const valLines = doc.splitTextToSize(String(v), innerW - 32);
    metaH += Math.max(6, valLines.length * 4.2 + 1);
  });
  const recLines = recommendation ? doc.splitTextToSize(recommendation, innerW - 30) : [];
  const recH = recommendation ? recLines.length * 4.4 + 6 : 0;
  const clHeaderH = checklist.length > 0 ? 6 : 0;
  let clItemH = 0;
  if (checklist.length > 0) {
    doc.setFontSize(9.5);
    checklist.forEach((item) => {
      const lines = doc.splitTextToSize(String(item), innerW - 6);
      clItemH += lines.length * 4.2;
    });
  }
  const stripH = 8;
  const padTop = 4;
  const padBottom = 4;
  return padTop + stripH + metaH + recH + clHeaderH + clItemH + padBottom + 3;
}

function drawTriageVerdictBox(doc, verdict, y) {
  const severity = verdict.severity || 'LOW';
  const confidence = (safeText(verdict.confidence) || '-').toUpperCase();
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

  // Severity color swatch on the left (replaces in-box badge -
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
  doc.text(`Severity: ${sev.label} - ${sev.word}`, textX, y + padTop + 4);

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
// SECTION 3 - EMERGENCY OVERRIDE (red-bordered alert, only if triggered)
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
  doc.text('CRITICAL - Life-threatening findings',
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
      doc.text('-', innerX, cursor);
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
      doc.text('-', innerX, cursor);
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
// SECTION 4 - REFERRAL PLAN
// Grayscale body with 1.6mm tier-tinted left rule + level badge text.
// =========================================================================
function drawReferralPlanBlock(doc, plan, y) {
  if (!plan || typeof plan !== 'object') return y;

  const level = String(plan.level || 'LOW').toUpperCase();
  const facilityType = String(plan.facilityType || '-').trim() || '-';
  const urgency = String(plan.urgency || '-').trim() || '-';
  const transportation = String(plan.transportation || '-').trim() || '-';
  const recommendation = String(plan.recommendation || '').trim();
  const checklist = Array.isArray(plan.checklist) ? plan.checklist : [];

  // Tier accent - only for left rule + level badge text
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
      doc.text('-', innerX, cursor);
      doc.text(lines, innerX + 4, cursor);
      cursor += lines.length * 4.2;
    });
  }

  return y + totalH + 3;
}
// =========================================================================
// SECTION 5 - VITAL SIGNS (pathology-style 4-column table)
// Parameter | Value | Unit | Status
// =========================================================================
function drawVitalsTable(doc, vitals, y) {
  const colX = [MARGIN_X, MARGIN_X + 80, MARGIN_X + 110, MARGIN_X + CONTENT_W];
  const rowH = 8;
  // Height of the table header (column-titles strip) including the rule
  // lines above and below. Reused both for the initial render and for
  // re-drawing the column titles after a page break.
  const headerH = 5 + 3 + 4.5; // 12.5 mm

  // Local helper: draw the top rule + 4-column titles + thin separator.
  // Called once for the initial table and again after every page break so
  // the reader always knows which column is which on a continued table.
  const drawTableHeader = (startY) => {
    let yy = startY;
    setDraw(doc, COLOR.ink);
    doc.setLineWidth(0.4);
    doc.line(MARGIN_X, yy, MARGIN_X + CONTENT_W, yy);
    yy += 5;

    setText(doc, COLOR.inkMuted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('PARAMETER', colX[0] + 2, yy);
    doc.text('VALUE',     colX[1] + 2, yy);
    doc.text('UNIT',      colX[2] + 2, yy);
    doc.text('STATUS',    colX[3] - 2, yy, { align: 'right' });
    yy += 3;

    setDraw(doc, COLOR.rule);
    doc.setLineWidth(0.2);
    doc.line(MARGIN_X, yy, MARGIN_X + CONTENT_W, yy);
    return yy + 4.5;
  };

  y = drawTableHeader(y);

  VITAL_FIELDS.forEach((f) => {
    // Step 24.1 - page-break awareness. Check that the next row + the
    // bottom rule (1.5mm) will fit above the footer band. If not, close
    // out the current page with a bottom rule, add a new page with the
    // header, and re-draw the table column titles so the reader can
    // continue the table without losing context.
    y = ensureSpace(doc, y, rowH + 1.5);
    if (y === MARGIN_TOP) {
      // ensureSpace triggered a page break - re-draw the table header.
      y = drawTableHeader(y);
    }

    const raw = vitals?.[f.key];
    const hasValue = !(raw === '' || raw == null);
    // BP is captured as a single "Systolic/Diastolic" string in VitalsForm
    // (e.g. "120/80"). The VITAL_FIELDS metadata above expects the same
    // shape, so `String(raw)` here renders the value verbatim and in the
    // exact order the CHW typed it - no swap, no formatting. The unit
    // column shows "mmHg" and the regex inside f.normal() reads m[1] as
    // systolic and m[2] as diastolic, keeping the rendering order in
    // agreement with the status-pill classification.
    const value = hasValue ? String(raw).trim() : '-';
    const evalRes = hasValue ? f.normal(raw) : { status: 'UNKNOWN', text: '-' };

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

  // Final bottom rule (0.4mm slate-900) - closes out the table.
  setDraw(doc, COLOR.ink);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y - 1.5, MARGIN_X + CONTENT_W, y - 1.5);
  return y + 2;
}

// =========================================================================
// SECTION 7 - LAB FINDINGS (pathology-style 4-column table)
// =========================================================================
// Step 24.2 - pure measure for the lab findings section. We do NOT
// atomicify the entire table (it can be arbitrarily long and forcing
// it onto a single page would break the lab's own intra-table page
// break). Instead we measure the header band + the first data row so
// the section title and at least the first row travel together.
function measureLabHeaderHeight(doc, labFindings) {
  if (!labFindings || typeof labFindings !== 'object') return 6;
  const rows = LAB_FIELDS
    .map((f) => {
      const raw = labFindings[f.key];
      if (raw === '' || raw == null) return null;
      return { key: f.key, label: f.label, value: String(raw), unit: f.unit };
    })
    .filter(Boolean);
  if (rows.length === 0) return 6; // placeholder line
  // Header band: 5 + 3 + 4.5 = 12.5mm
  return 12.5;
}

// =========================================================================
// Step 24.3 - atomic-block measure companions
// Each measure function below mirrors the vertical geometry of its
// matching draw* helper so that withAtomicBlock(doc, y, h, render)
// can be called with the exact height. If `h` exceeds the space
// remaining on the current page, withAtomicBlock forces a page break
// and re-draws the section title on the new page, so title + body
// always travel together as one unit.
// =========================================================================

// Vital signs table - header band (12.5mm) + 6 data rows (8mm each)
// + bottom rule + 2mm tail gap. We intentionally measure for ALL
// VITAL_FIELDS rows because vital signs must stay together: a vitals
// table that breaks across pages is unreadable in a clinical setting.
function measureVitalsTableHeight(doc, vitals) {
  const headerH = 5 + 3 + 4.5; // matches drawVitalsTable header band
  const rowH = 8;
  return headerH + VITAL_FIELDS.length * rowH + 2;
}

// Generic list measure. Used for drawNumberedList, drawBulletList,
// and drawFirstAidList. Mirrors the exact line-height math used in
// each draw function so a measured block that fits will render
// identically. The caller is responsible for passing a sanitized
// `items` array (use asStringList() for the same shape the draw
// function consumes).
function measureListBlockHeight(doc, items, opts = {}) {
  const {
    lineH = 4.4,
    gap  = 1.4,         // extra spacing between items (matches drawNumberedList)
    width = CONTENT_W,  // default full content width
    indent = 12,        // matches drawNumberedList (number column ~8mm + 4 gutter)
    emptyFallbackH = 5, // matches "None recorded." line height
  } = opts;
  const safe = Array.isArray(items) ? items.filter((s) => s && String(s).trim()) : [];
  if (safe.length === 0) return emptyFallbackH;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  let total = 0;
  safe.forEach((it) => {
    const lines = doc.splitTextToSize(String(it), width - indent);
    total += lines.length * lineH + gap;
  });
  return total;
}

// Wrapped-paragraph measure. Mirrors drawWrappedText exactly: the
// caller passes the same `opts` (fontSize, lineHeight, maxWidth) and
// we return `lines.length * lineHeight`. Used by the Clinical
// Summary and the Referral Recommendation sections.
function measureWrappedTextHeight(doc, text, opts = {}) {
  const {
    maxWidth = CONTENT_W,
    font = 'helvetica',
    style = 'normal',
    size = 9.5,
    lineHeight = 4.4,
  } = opts;
  const safe = text == null ? '' : String(text).trim();
  if (!safe) return lineHeight; // matches drawWrappedText's "if (!text) return y"
  doc.setFont(font, style);
  doc.setFontSize(size);
  const lines = doc.splitTextToSize(safe, maxWidth);
  return lines.length * lineHeight;
}

// First Aid measure. Mirrors drawFirstAidList: "[+]" marker at
// MARGIN_X+2, text at MARGIN_X+8 with CONTENT_W-14 wrap width,
// lineH 4.4 + gap 1.2 per item, +2 tail gap.
function measureFirstAidListHeight(doc, firstAid) {
  const items = Array.isArray(firstAid?.firstAidItems) ? firstAid.firstAidItems : [];
  if (items.length === 0) return 0;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  let total = 0;
  items.forEach((it) => {
    const text = (it && typeof it === 'object')
      ? (it.en || it.bn || '')
      : String(it || '');
    if (!text) return;
    const lines = doc.splitTextToSize(text, CONTENT_W - 14);
    total += lines.length * 4.4 + 1.2;
  });
  return total + 2; // +2 tail gap matches draw()
}

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
  if (rows.length === 0) {
    // Empty lab section: print a single italic placeholder so the section
    // doesn't look like a rendering bug. Matches the "None recorded." style
    // used by drawNumberedList / drawBulletList above. Use ensureSpace so
    // the placeholder never overlaps the footer.
    y = ensureSpace(doc, y, 6);
    setText(doc, COLOR.inkFaint);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.text('No laboratory values recorded.', MARGIN_X, y);
    return y + 6;
  }

  const colX = [MARGIN_X, MARGIN_X + 80, MARGIN_X + 110, MARGIN_X + CONTENT_W];
  const rowH = 8;

  // Local helper: top rule + 4-column titles + thin separator. Reused for
  // the initial draw and again after each page break so the reader can
  // continue the table without losing context.
  const drawTableHeader = (startY) => {
    let yy = startY;
    setDraw(doc, COLOR.ink);
    doc.setLineWidth(0.4);
    doc.line(MARGIN_X, yy, MARGIN_X + CONTENT_W, yy);
    yy += 5;

    setText(doc, COLOR.inkMuted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text('PARAMETER', colX[0] + 2, yy);
    doc.text('VALUE',     colX[1] + 2, yy);
    doc.text('UNIT',      colX[2] + 2, yy);
    doc.text('STATUS',    colX[3] - 2, yy, { align: 'right' });
    yy += 3;

    setDraw(doc, COLOR.rule);
    doc.setLineWidth(0.2);
    doc.line(MARGIN_X, yy, MARGIN_X + CONTENT_W, yy);
    return yy + 4.5;
  };

  y = drawTableHeader(y);

  rows.forEach((r) => {
    // Step 24.1 - page-break awareness. If the next row + the bottom rule
    // (1.5mm) would push past the footer band, close the current page with
    // its bottom rule, start a new page, and re-draw the column titles.
    y = ensureSpace(doc, y, rowH + 1.5);
    if (y === MARGIN_TOP) {
      y = drawTableHeader(y);
    }

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
// SECTION 10 - FIRST AID RECOMMENDATIONS (English-only + checklist)
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

    // Checklist marker. jsPDF's built-in Helvetica only covers WinAnsi, so
    // any non-ASCII glyph (U+2713 +, U+2022 -, U+25A0 +) renders as garbage
    // or as a tofu box. Use a safe ASCII "[+]" prefix that prints reliably
    // on every Windows/macOS PDF viewer and matches the rest of the report.
    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('[+]', MARGIN_X + 2, cursor);

    setText(doc, COLOR.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.text(lines, MARGIN_X + 8, cursor);
    cursor += blockH;
  });
  return cursor + 2;
}

// =========================================================================
// SECTION 11 / 12 - Monospace bordered block (Voice + OCR)
// Step 24.1 - supports auto-paging for long Bengali transcripts.
// Long blocks are split into chunks; each chunk gets its own bordered
// rect on its own page. If a single chunk is itself too tall for the
// available page area (e.g. a very long single line of text), the
// internal split is bounded by `maxLines` so the rect never overflows
// the footer band.
// =========================================================================
// Step 24.2 - pure measure for the monospace block. Returns the
// section title (~9mm) + the height of one chunk of monospace text
// (the smallest atomic unit: if the section title + one chunk can't
// fit on the current page, move the whole block to the next page).
function measureMonoBlockHeight(doc, text) {
  const safe = text && text.trim().length > 0 ? text.trim() : 'Not provided.';
  doc.setFont('courier', 'normal');
  doc.setFontSize(9);
  const lines = doc.splitTextToSize(safe, CONTENT_W - 8);
  const lineH = 4.4;
  const rectPad = 5;
  // Section title height + a minimum 3-line chunk (or whatever fits,
  // bounded so a 1-line input still produces a visible block).
  const firstChunk = Math.max(3, lines.length);
  return 9 + firstChunk * lineH + rectPad * 2;
}

function drawMonoBlock(doc, label, text, y) {
  y = drawSectionTitle(doc, y, label);
  const safeText = text && text.trim().length > 0 ? text.trim() : 'Not provided.';
  doc.setFont('courier', 'normal');
  doc.setFontSize(9);
  setText(doc, COLOR.ink);
  const lines = doc.splitTextToSize(safeText, CONTENT_W - 8);

  // Geometry constants. lineH is the rendered height of one monospace
  // line at 9pt. rectPad is the inner padding inside the bordered rect.
  const lineH = 4.4;
  const rectPad = 5; // top/bottom padding inside the border

  // Render a single chunk of `chunkLines` into a bordered rect at the
  // current y. The caller is responsible for ensuring the chunk fits.
  const renderChunk = (chunkLines) => {
    const blockH = chunkLines.length * lineH + rectPad * 2;
    setDraw(doc, COLOR.rule);
    doc.setLineWidth(0.3);
    doc.rect(MARGIN_X, y, CONTENT_W, blockH);
    doc.text(chunkLines, MARGIN_X + 4, y + rectPad);
    return y + blockH;
  };

  // Step 24.1 - chunked rendering. For each chunk, ask ensureSpace
  // whether the chunk (border + text) will fit on the current page. If
  // not, add a new page with a fresh section title and start the chunk
  // at the top of the new page. After rendering, advance y past the
  // rect and continue with the next chunk.
  let i = 0;
  while (i < lines.length) {
    // How many lines can fit on the current page from y to the footer?
    const availH = contentLimit() - y;
    // Reserve space for the next-page section title (~9mm) when a page
    // break is required, so we never strand the title at the bottom of
    // a page with no content to follow.
    const usableH = availH - 9;
    const maxLines = Math.max(1, Math.floor((usableH - rectPad * 2) / lineH));
    const chunkSize = Math.min(maxLines, lines.length - i);
    const chunk = lines.slice(i, i + chunkSize);

    // If a single chunk can't even fit (very tall first chunk on an
    // already-full page), force a page break to keep the section title
    // together with the first lines of content.
    y = ensureSpace(doc, y, chunk.length * lineH + rectPad * 2);
    y = renderChunk(chunk);
    i += chunkSize;

    if (i < lines.length) {
      // More content remains. Close this page's rect and start a new one
      // with a fresh section title so the reader knows we're continuing.
      y += 3;
      doc.addPage();
      drawPageHeader(doc, {
        severity: currentReportState.severity,
        reportId: currentReportState.reportId,
        generatedAt: currentReportState.generatedAt,
      });
      y = MARGIN_TOP;
      y = drawSectionTitle(doc, y, label + ' (continued)');
    } else {
      y += 3; // tail gap before next section
    }
  }

  return y;
}

// =========================================================================
// FINAL-PAGE - AI Disclaimer (italic, slate-600)
// =========================================================================
// Step 24.2 - pure measure for the AI disclaimer. The block is small
// but we still atomicify it: if the section title has landed at the
// bottom of a page with the disclaimer about to overflow, the whole
// block (title + body) moves to the next page.
function measureAiDisclaimerHeight(doc) {
  setText(doc, COLOR.inkMuted);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  const text =
    'AI Disclaimer - This report is generated using AI-assisted triage support and should not replace professional clinical judgment. Final diagnosis and treatment decisions remain the responsibility of licensed healthcare professionals.';
  const lines = doc.splitTextToSize(text, CONTENT_W);
  return 5 + lines.length * 8.5 * 0.4 + 5; // rule + body + tail
}

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
    'AI Disclaimer - This report is generated using AI-assisted triage support and should not replace professional clinical judgment. Final diagnosis and treatment decisions remain the responsibility of licensed healthcare professionals.',
    MARGIN_X, y,
    { maxWidth: CONTENT_W, lineHeightFactor: 1.4 }
  );
  return y + 10;
}
// =========================================================================
// MAIN EXPORT - generatePhysicianPdf
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
  // Test hook. When `__skipSave` is true, the function skips the
  // browser-only `doc.save()` call and returns the jsPDF instance
  // itself along with metadata. Production callers should never set
  // this. Used by the Step 24.1 Node repro test to inspect
  // pagination and footer presence without triggering a download.
  __skipSave = false,
  referralPlan = null,
  outputLanguage = 'en', // accepted but ignored - PDF is English-only
} = {}) {
  if (!verdict || !verdict.severity) {
    throw new Error('generatePhysicianPdf: verdict with severity is required.');
  }

  // ── Defensive normalization ────────────────────────────────────────────
  // The backend already normalizes most fields, but rule-based fallbacks
  // (TriageResult.jsx local computation) and any older cached payloads can
  // still hand us non-primitive shapes. Coerce every user-derived input
  // here so that every downstream draw* call is guaranteed safe primitives.
  // Step 24.3 - also pipe text fields through `toPdfText` (and the
  // dedicated `normalizeTranscriptForPdf` / `normalizeOcrForPdf`
  // helpers) so any stray Bengali / smart-punct / control char
  // character is replaced before it can reach jsPDF's WinAnsi encoder.
  // The PDF is English-only by spec, so when a transcript / OCR text
  // arrives in Bengali, we substitute a fixed English placeholder
  // string instead of attempting transliteration.
  const safeVerdict = {
    severity: String(verdict.severity || 'LOW').toUpperCase(),
    confidence: toPdfText(verdict.confidence, { placeholder: 'Unknown' }),
    summary: toPdfText(verdict.summary, { placeholder: 'No clinical summary provided.' }),
    possible_conditions: asStringList(verdict.possible_conditions).map((s) => toPdfText(s)),
    recommended_actions: asStringList(verdict.recommended_actions).map((s) => toPdfText(s)),
    referral: toPdfText(verdict.referral, { placeholder: 'No referral guidance provided.' }),
  };
  const safeAlerts = asStringList(alerts).map((s) => toPdfText(s));
  const safeLabAlerts = asStringList(labAlerts).map((s) => toPdfText(s));
  // Bengali voice / OCR inputs are intentionally replaced with an
  // English placeholder string. This is the only place where a
  // non-English input doesn't reach the PDF byte stream.
  const safeVoiceTranscript = normalizeTranscriptForPdf(voiceTranscript);
  const safeOcrText = normalizeOcrForPdf(ocrText);

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
    // Step 24.2 - atomicify the override block: never split the
    // callout across a page boundary.
    y = withAtomicBlock(
      doc, y,
      measureEmergencyOverrideBlockHeight(doc, safeOverride),
      (yy) => drawEmergencyOverrideBlock(doc, safeOverride, yy)
    );
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
    // Step 24.2 - atomicify the referral plan block.
    y = withAtomicBlock(
      doc, y,
      measureReferralPlanBlockHeight(doc, safePlan),
      (yy) => drawReferralPlanBlock(doc, safePlan, yy)
    );
  }

  // ---- 3. PATIENT INFORMATION -----------------------------------------
  // Step 24.2 - patient info is atomic: section title + the whole
  // table move together to the next page if they don't fit. We
  // pre-render the section title at the *current* y, but `withAtomicBlock`
  // may move the title too - so we render the title inside the
  // atomic block instead of before it.
  y = withAtomicBlock(
    doc, y,
    // section title (~9mm) + measured table height
    9 + measurePatientInfoTableHeight(doc, patientInfo),
    (yy) => {
      yy = drawSectionTitle(doc, yy, 'Patient Information');
      yy = drawPatientInfoTable(doc, patientInfo, yy);
      return yy + 4;
    }
  );

  // ---- 4. TRIAGE VERDICT BOX (severity-colored accent) ----------------
  // Step 24.2 - verdict card is atomic: never split across pages.
  y = withAtomicBlock(
    doc, y,
    measureTriageVerdictBoxHeight(doc, safeVerdict),
    (yy) => drawTriageVerdictBox(doc, safeVerdict, yy) + 4
  );

  // ---- 5. PATIENT VITALS (4-column pathology-style) -------------------
  // Step 24.3 - vital signs are atomic. The pathology-style 4-column
  // table must stay together: a vitals table that breaks across
  // pages would leave a CHW guessing which row is which. Render the
  // section title INSIDE the atomic block so the title + the table
  // move to the next page as a unit.
  y = withAtomicBlock(
    doc, y,
    // section title (~9mm) + measured table height
    9 + measureVitalsTableHeight(doc, vitals),
    (yy) => {
      yy = drawSectionTitle(doc, yy, 'Patient Vitals');
      yy = drawVitalsTable(doc, vitals, yy);
      return yy + 4;
    }
  );

  // ---- 6. ANOMALY FINDINGS --------------------------------------------
  // Step 24.3 - anomaly findings are atomic. The section title and
  // the entire numbered list travel together to the next page if
  // they don't fit. Empty list still renders a 1-line "None
  // recorded." placeholder, so the measure must include that line.
  y = withAtomicBlock(
    doc, y,
    9 + Math.max(5, measureListBlockHeight(doc, safeAlerts)),
    (yy) => {
      yy = drawSectionTitle(doc, yy, 'Anomaly Findings');
      yy = drawNumberedList(doc, safeAlerts, yy);
      return yy + 4;
    }
  );

  // ---------------------- PAGE 2 (conditional) ----------------------
  // Step 24.2 - the hard `doc.addPage()` has been removed. The design
  // still favors a Page 1 / Page 2 split for analyst navigation, but
  // page breaks are now driven by content + the atomic-block guards:
  // if the lab header + the AI disclaimer can't both fit on the
  // current page, the first atomic block will pull us onto a new page.
  // We pre-check here so the split happens cleanly between the page-1
  // (clinical) and page-2 (documentation) content groups, not in the
  // middle of the lab table.
  {
    const page2MinH = 18 + measureLabHeaderHeight(doc, labFindings) + 6;
    if (y + page2MinH > contentLimit()) {
      doc.addPage();
      drawPageHeader(doc, {
        severity: safeVerdict.severity,
        reportId,
        generatedAt,
      });
      y = bodyTop();
    }
  }

  // ---- 7. LAB FINDINGS ------------------------------------------------
  // Step 24.2 - the section title + the table header travel together as
  // one atomic unit. Once the header is on a page, the rest of the rows
  // are split row-by-row (lab data is naturally long and we don't want
  // to force it all onto one page).
  y = withAtomicBlock(
    doc, y,
    9 + measureLabHeaderHeight(doc, labFindings),
    (yy) => {
      yy = drawSectionTitle(doc, yy, 'Laboratory Findings');
      yy = drawLabFindingsTable(doc, labFindings, yy);
      return yy + 4;
    }
  );

  // ---- 7b. LAB ALERTS (only if present) -------------------------------
  // Step 24.3 - lab alerts are atomic: the section title and the
  // entire numbered list stay together. Wrapped only when present
  // (no need to reserve a section title for an empty section).
  if (safeLabAlerts.length > 0) {
    y = withAtomicBlock(
      doc, y,
      9 + measureListBlockHeight(doc, safeLabAlerts),
      (yy) => {
        yy = drawSectionTitle(doc, yy, 'Lab Alerts');
        yy = drawNumberedList(doc, safeLabAlerts, yy);
        return yy + 4;
      }
    );
  }

  // ---- 8. CLINICAL SUMMARY --------------------------------------------
  // Step 24.3 - clinical summary is atomic. Long summaries that
  // would otherwise leave a stranded title at the bottom of a page
  // are pulled forward to the next page with their first lines of
  // body text. drawWrappedText signature: (doc, text, x, y, opts).
  // The previous call passed `y` as the 3rd arg, which made the
  // `opts` object land in the `y` slot of `doc.text(lines, x, y)` and
  // throw "Invalid arguments passed to jsPDF.text". Pass MARGIN_X as
  // the x-coordinate so body text aligns with the section content.
  y = withAtomicBlock(
    doc, y,
    9 + measureWrappedTextHeight(
      doc,
      safeVerdict.summary,
      { fontSize: 9.5, lineHeight: 4.8 }
    ),
    (yy) => {
      yy = drawSectionTitle(doc, yy, 'Clinical Summary');
      yy = drawWrappedText(doc, safeVerdict.summary, MARGIN_X, yy, { fontSize: 9.5, lineHeight: 4.8 });
      return yy + 4;
    }
  );

  // ---- 9. POSSIBLE CONDITIONS -----------------------------------------
  // Step 24.3 - possible conditions are atomic. The numbered list
  // moves to the next page as a unit so we never show a "Possible
  // Conditions" header followed by a blank "None recorded." line
  // at the bottom of a page.
  y = withAtomicBlock(
    doc, y,
    9 + Math.max(5, measureListBlockHeight(doc, safeVerdict.possible_conditions)),
    (yy) => {
      yy = drawSectionTitle(doc, yy, 'Possible Conditions');
      yy = drawNumberedList(doc, safeVerdict.possible_conditions, yy);
      return yy + 4;
    }
  );

  // ---- 10. RECOMMENDED ACTIONS ----------------------------------------
  // Step 24.3 - recommended actions are atomic. Same pattern as
  // possible conditions: title + numbered list travel together.
  y = withAtomicBlock(
    doc, y,
    9 + Math.max(5, measureListBlockHeight(doc, safeVerdict.recommended_actions)),
    (yy) => {
      yy = drawSectionTitle(doc, yy, 'Recommended Actions');
      yy = drawNumberedList(doc, safeVerdict.recommended_actions, yy);
      return yy + 4;
    }
  );

  // ---- 11. FIRST AID RECOMMENDATIONS (English-only) -------------------
  // Step 24.3 - first aid checklist is atomic. Each item is "[+]
  // text", and a long list of first-aid steps must stay together
  // with its section title so the checklist reads top-to-bottom on
  // one page. Wrapped only when at least one item is present.
  if (firstAid && Array.isArray(firstAid.firstAidItems) && firstAid.firstAidItems.length > 0) {
    y = withAtomicBlock(
      doc, y,
      9 + measureFirstAidListHeight(doc, firstAid),
      (yy) => {
        yy = drawSectionTitle(doc, yy, 'First Aid Recommendations');
        yy = drawFirstAidList(doc, firstAid, yy);
        return yy + 4;
      }
    );
  }

  // ---- 12. REFERRAL RECOMMENDATION (free text) ------------------------
  // Step 24.3 - referral recommendation is atomic. The section
  // title and the (possibly multi-line) body travel together.
  // When an Emergency Override is active, getReferralRecommendation() returns
  // a plan built from the EMERGENCY tier (whose `recommendation` is a static
  // string) and ignores `override.referral` (the one-liner the CHW actually
  // sees in the EmergencyOverrideCard). To keep the PDF, the override callout,
  // and the on-screen result panel consistent, prefer the override's
  // one-liner here whenever it triggered. Falls back to the AI verdict's
  // `referral` (or the standard placeholder) when no override is active.
  const overrideReferral =
    emergencyOverride && emergencyOverride.triggered
      ? toPdfText(emergencyOverride.referral, { placeholder: '' })
      : '';
  const referralText = overrideReferral || safeVerdict.referral || 'No referral guidance provided.';
  // drawWrappedText signature: (doc, text, x, y, opts) - pass MARGIN_X
  // explicitly. (See fix in section 8 - same root cause: missing x arg.)
  y = withAtomicBlock(
    doc, y,
    9 + measureWrappedTextHeight(doc, referralText),
    (yy) => {
      yy = drawSectionTitle(doc, yy, 'Referral Recommendation');
      yy = drawWrappedText(doc, referralText, MARGIN_X, yy);
      return yy + 4;
    }
  );

  // ---- 13. VOICE TRANSCRIPT (monospace block) -------------------------
  // Step 24.2 - Voice block: the section title + the first monospace
  // chunk are atomic. drawMonoBlock handles its own internal paging
  // (Step 24.1) for chunks beyond the first.
  y = withAtomicBlock(
    doc, y,
    measureMonoBlockHeight(doc, safeVoiceTranscript),
    (yy) => drawMonoBlock(doc, 'Voice Transcript / Symptoms Notes', safeVoiceTranscript, yy) + 2
  );

  // ---- 14. OCR EXTRACTED TEXT (monospace block) -----------------------
  y = withAtomicBlock(
    doc, y,
    measureMonoBlockHeight(doc, safeOcrText),
    (yy) => drawMonoBlock(doc, 'OCR Extracted Text', safeOcrText, yy)
  );

  // ---- 15. AI DISCLAIMER (italic footnote) ----------------------------
  // Step 24.2 - AI disclaimer is small but atomic: title + body travel
  // together to the next page if they don't fit.
  y = withAtomicBlock(
    doc, y,
    measureAiDisclaimerHeight(doc),
    (yy) => drawAiDisclaimer(doc, yy)
  );

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
  if (!__skipSave) {
    doc.save(filename);
  }

  if (__skipSave) {
    // Test-only return: include the doc instance so the caller can
    // call .output() and verify pagination / footer presence. Never
    // returned in production.
    return { filename, pageCount: total, doc };
  }
  return { filename, pageCount: total };
}

export default generatePhysicianPdf;
