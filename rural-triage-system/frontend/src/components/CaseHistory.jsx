// Shuruksha Link — Case History panel.
// Lists every triage case saved to LocalStorage in reverse chronological
// order, with click-to-reopen, per-card delete, and a "Clear all" action.
// Pure presentational; receives the current list and emits intent events
// up to the parent (App.jsx) which owns the data flow.

import { useState } from 'react';
import { formatTimestamp } from '../utils/caseHistory.js';

// Same severity palette used elsewhere in the app so the cards look
// familiar next to the AI Assistant panel.
const SEVERITY_META = {
  LOW:      { label: 'Low',      cls: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30',   dot: 'bg-emerald-400' },
  MEDIUM:   { label: 'Medium',   cls: 'bg-amber-500/15 text-amber-100 ring-amber-400/30',         dot: 'bg-amber-300' },
  HIGH:     { label: 'High',     cls: 'bg-orange-500/15 text-orange-100 ring-orange-400/30',     dot: 'bg-orange-300' },
  CRITICAL: { label: 'Critical', cls: 'bg-rose-500/20 text-rose-100 ring-rose-400/40',            dot: 'bg-rose-300' },
};

function SeverityBadge({ severity }) {
  const meta = SEVERITY_META[severity] || SEVERITY_META.LOW;
  return (
    <span
      className={
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ' +
        meta.cls
      }
      aria-label={`Severity ${meta.label}`}
    >
      <span className={'h-1.5 w-1.5 rounded-full ' + meta.dot} aria-hidden="true" />
      {meta.label}
    </span>
  );
}

function SummaryLine({ text }) {
  const trimmed = (text || '').trim();
  if (!trimmed) {
    return <span className="italic text-sky-100/50">No summary recorded.</span>;
  }
  // Clamp to ~160 chars for card previews; full text shows on reopen.
  const preview = trimmed.length > 160 ? trimmed.slice(0, 157) + '…' : trimmed;
  return <span className="text-sky-50/90">{preview}</span>;
}

// --- Empty state ---------------------------------------------------------
function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.03] p-6 text-center">
      <div className="mx-auto h-10 w-10 rounded-full bg-white/10 grid place-items-center text-cyan-200">
        <svg
          xmlns="http://www.w3://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      </div>
      <p className="mt-3 text-sm font-semibold text-white">No cases saved yet</p>
      <p className="mt-1 text-xs text-sky-100/70 max-w-sm mx-auto">
        Completed triage requests will appear here automatically. Click any
        card to reopen its full details.
      </p>
    </div>
  );
}

// --- Main export ---------------------------------------------------------
export default function CaseHistory({ cases, onReopen, onDelete, onClearAll }) {
  // Track the case currently pending deletion confirmation.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const safeCases = Array.isArray(cases) ? cases : [];
  const hasCases = safeCases.length > 0;

  return (
    <section
      className="
        relative overflow-hidden
        rounded-2xl
        bg-gradient-to-br from-slate-900 via-sky-900 to-cyan-900
        text-white
        shadow-xl shadow-sky-900/20
        border border-slate-800
        p-6 sm:p-7
      "
      aria-label="Case history"
    >
      {/* Decorative orbs (match the AI Assistant panel) */}
      <div className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full bg-cyan-400/15 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-16 -left-10 h-48 w-48 rounded-full bg-sky-400/15 blur-3xl" aria-hidden="true" />

      <div className="relative flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur px-3 py-1 text-xs font-semibold uppercase tracking-wider text-cyan-200 ring-1 ring-white/15">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" aria-hidden="true" />
            Audit Trail
          </div>
          <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight">
            Case History
            <span className="ml-2 text-base font-medium text-sky-100/70">কেস ইতিহাস</span>
          </h2>
          <p className="mt-1 text-sm text-sky-100/80">
            {hasCases
              ? `${safeCases.length} saved case${safeCases.length === 1 ? '' : 's'} — newest first.`
              : 'Completed triage requests will be saved here automatically.'}
          </p>
        </div>

        {hasCases && (
          <button
            type="button"
            onClick={() => setConfirmClear(true)}
            className="
              inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider
              bg-rose-500/15 text-rose-100 ring-1 ring-rose-400/30
              hover:bg-rose-500/25 active:scale-[0.98] transition
            "
            aria-label="Clear all case history"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
              aria-hidden="true"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
              <path d="M10 11v6M14 11v6" />
            </svg>
            Clear All History
          </button>
        )}
      </div>

      <div className="relative mt-5">
        {hasCases ? (
          <ul className="space-y-2.5">
            {safeCases.map((c) => {
              const isPending = pendingDelete === c.id;
              return (
                <li
                  key={c.id}
                  className="
                    group rounded-xl bg-white/5 border border-white/10
                    hover:bg-white/[0.08] hover:border-white/20
                    transition
                    p-4
                  "
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => onReopen && onReopen(c)}
                      className="
                        flex-1 min-w-0 text-left
                        flex items-start gap-3
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 rounded-lg
                      "
                      aria-label={`Reopen case from ${formatTimestamp(c.timestamp)}`}
                    >
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cyan-300 group-hover:bg-cyan-200" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <SeverityBadge severity={c.severity} />
                          <span className="text-xs font-mono text-sky-100/80">
                            {formatTimestamp(c.timestamp)}
                          </span>
                          <span className="text-[10px] uppercase tracking-wider text-sky-100/50">
                            {c.confidence || 'low'} conf
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm leading-relaxed">
                          <SummaryLine text={c.summary} />
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isPending ? (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              if (onDelete) onDelete(c.id);
                              setPendingDelete(null);
                            }}
                            className="
                              rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider
                              bg-rose-500 text-white hover:bg-rose-600 active:scale-[0.98] transition
                            "
                            aria-label="Confirm delete"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDelete(null)}
                            className="
                              rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider
                              bg-white/10 text-sky-100 ring-1 ring-white/20 hover:bg-white/15 active:scale-[0.98] transition
                            "
                            aria-label="Cancel delete"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPendingDelete(c.id)}
                          className="
                            rounded-full p-1.5 text-sky-100/70
                            hover:text-rose-200 hover:bg-rose-500/15
                            active:scale-[0.95] transition
                            opacity-60 group-hover:opacity-100
                          "
                          aria-label={`Delete case from ${formatTimestamp(c.timestamp)}`}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-4 w-4"
                            aria-hidden="true"
                          >
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState />
        )}
      </div>

      {/* Clear-all confirmation modal */}
      {confirmClear && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-all-title"
          onClick={() => setConfirmClear(false)}
        >
          <div
            className="
              w-full max-w-md rounded-2xl
              bg-gradient-to-br from-slate-900 via-sky-900 to-cyan-900
              border border-white/15 shadow-2xl
              p-6
            "
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="clear-all-title" className="text-lg font-bold text-white">
              Clear all case history?
            </h3>
            <p className="mt-2 text-sm text-sky-100/80">
              This will permanently remove all {safeCases.length} saved
              case{safeCases.length === 1 ? '' : 's'} from this browser. This
              action cannot be undone.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="
                  rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wider
                  bg-white/10 text-sky-100 ring-1 ring-white/20
                  hover:bg-white/15 active:scale-[0.98] transition
                "
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onClearAll) onClearAll();
                  setConfirmClear(false);
                }}
                className="
                  rounded-full px-4 py-2 text-xs font-bold uppercase tracking-wider
                  bg-rose-500 text-white hover:bg-rose-600 active:scale-[0.98] transition
                "
              >
                Yes, Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
