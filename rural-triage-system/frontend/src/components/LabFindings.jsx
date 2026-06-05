// LabFindings — renders the structured lab findings extracted from OCR.
//
// Renders three visual states:
//   1. Empty       → friendly hint that no lab values were found yet
//   2. Findings    → Parameter | Value | Unit | Status table (one row per
//                    extracted lab value, with a colored Status pill)
//   3. Findings + alerts → same table, with a small ALERTS strip below
//                          listing the rule-based medical flags
//
// Pure presentational. All extraction logic lives in
// `utils/parseMedicalReport.js`.

import { LAB_FIELDS } from '../utils/parseMedicalReport.js';

// Status → Tailwind pill (matches the AI Assistant panel's dark theme).
// Keys: NORMAL | LOW | HIGH | CRITICAL | UNKNOWN
const STATUS_STYLE = {
  NORMAL: {
    label: 'Normal',
    cls: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30',
    dot: 'bg-emerald-400',
  },
  LOW: {
    label: 'Low',
    cls: 'bg-amber-500/15 text-amber-100 ring-amber-400/30',
    dot: 'bg-amber-300',
  },
  HIGH: {
    label: 'High',
    cls: 'bg-orange-500/15 text-orange-100 ring-orange-400/30',
    dot: 'bg-orange-300',
  },
  CRITICAL: {
    label: 'Critical',
    cls: 'bg-rose-500/20 text-rose-100 ring-rose-400/40',
    dot: 'bg-rose-300',
  },
  UNKNOWN: {
    label: '—',
    cls: 'bg-slate-500/15 text-sky-100/60 ring-white/10',
    dot: 'bg-slate-400',
  },
};

function StatusPill({ status }) {
  const meta = STATUS_STYLE[status] || STATUS_STYLE.UNKNOWN;
  return (
    <span
      className={
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ' +
        meta.cls
      }
    >
      <span className={'h-1.5 w-1.5 rounded-full ' + meta.dot} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function AlertChip({ text }) {
  return (
    <li className="flex items-start gap-2 rounded-lg bg-rose-500/10 ring-1 ring-rose-400/25 px-2.5 py-1.5 text-[11px] text-rose-50">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-3.5 w-3.5 mt-0.5 text-rose-300 shrink-0"
        aria-hidden="true"
      >
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span>{text}</span>
    </li>
  );
}

function EmptyHint() {
  return (
    <div className="rounded-lg border border-dashed border-white/15 px-3 py-3 text-[11px] text-sky-100/70">
      No lab values detected yet. Upload a prescription or lab report image in
      the <span className="font-semibold text-cyan-200">Document Scan</span>{' '}
      section above.
    </div>
  );
}

export default function LabFindings({ labFindings = {}, labAlerts = [] }) {
  // Filter to only fields we actually extracted (presence of a numeric value).
  const rows = LAB_FIELDS.map((f) => ({
    ...f,
    value: labFindings[f.key],
    status: labFindings[`${f.key}_status`] || 'UNKNOWN',
  })).filter((r) => r.value !== undefined && r.value !== null);

  const hasFindings = rows.length > 0;
  const hasAlerts = Array.isArray(labAlerts) && labAlerts.length > 0;

  return (
    <div className="rounded-xl bg-white/5 border border-white/10 p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4 text-cyan-200"
            aria-hidden="true"
          >
            <path d="M3 3h18v4H3z" />
            <path d="M5 7v14h14V7" />
            <path d="M9 12h6M9 16h6" />
          </svg>
          <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-200">
            Lab Findings
          </h4>
        </div>
        {hasAlerts && (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 text-rose-200 ring-1 ring-rose-400/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
            {labAlerts.length} Alert{labAlerts.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {!hasFindings && <EmptyHint />}

      {hasFindings && (
        <div className="overflow-hidden rounded-lg ring-1 ring-white/10">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-white/5 text-sky-100/80">
                <th className="px-2.5 py-1.5 text-left font-semibold uppercase tracking-wider text-[10px]">
                  Parameter
                </th>
                <th className="px-2.5 py-1.5 text-right font-semibold uppercase tracking-wider text-[10px]">
                  Value
                </th>
                <th className="px-2.5 py-1.5 text-left font-semibold uppercase tracking-wider text-[10px] hidden sm:table-cell">
                  Unit
                </th>
                <th className="px-2.5 py-1.5 text-right font-semibold uppercase tracking-wider text-[10px]">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  className="border-t border-white/10 text-sky-50/95"
                >
                  <td className="px-2.5 py-1.5">{r.label}</td>
                  <td className="px-2.5 py-1.5 text-right font-mono tabular-nums">
                    {typeof r.value === 'number' && Number.isFinite(r.value)
                      ? r.value.toLocaleString('en-US')
                      : '—'}
                  </td>
                  <td className="px-2.5 py-1.5 text-sky-100/60 hidden sm:table-cell">
                    {r.unit}
                  </td>
                  <td className="px-2.5 py-1.5 text-right">
                    <StatusPill status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasAlerts && (
        <div className="mt-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-rose-200/90 mb-1.5">
            Lab Alerts
          </p>
          <ul className="space-y-1.5">
            {labAlerts.map((a, i) => (
              <AlertChip key={i} text={a} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
