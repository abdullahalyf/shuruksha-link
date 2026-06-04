// TriageResult — renders the Gemini verdict in the AI Assistant panel.
// Handles four states: idle (empty), loading, error, and data.
// Pure presentational; receives a `state` object from App.jsx:
//
//   { status: 'idle' | 'loading' | 'error' | 'success',
//     verdict?: TriageVerdict, error?: string }

const SEVERITY_META = {
  LOW: {
    label: 'Low',
    bn: 'কম ঝুঁকি',
    chip: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30',
    banner: 'from-emerald-500/20 to-teal-500/20 ring-emerald-400/30',
    accent: 'text-emerald-200',
    dot: 'bg-emerald-400',
  },
  MEDIUM: {
    label: 'Medium',
    bn: 'মাঝারি',
    chip: 'bg-amber-500/15 text-amber-100 ring-amber-400/30',
    banner: 'from-amber-500/20 to-orange-500/20 ring-amber-400/30',
    accent: 'text-amber-100',
    dot: 'bg-amber-300',
  },
  HIGH: {
    label: 'High',
    bn: 'উচ্চ',
    chip: 'bg-orange-500/15 text-orange-100 ring-orange-400/30',
    banner: 'from-orange-500/20 to-rose-500/20 ring-orange-400/30',
    accent: 'text-orange-100',
    dot: 'bg-orange-300',
  },
  CRITICAL: {
    label: 'Critical',
    bn: 'গুরুতর',
    chip: 'bg-rose-500/20 text-rose-100 ring-rose-400/40',
    banner: 'from-rose-500/25 to-red-500/25 ring-rose-400/40',
    accent: 'text-rose-100',
    dot: 'bg-rose-300',
  },
};

const CONFIDENCE_META = {
  low: { label: 'Low confidence', cls: 'text-rose-200/80' },
  medium: { label: 'Medium confidence', cls: 'text-amber-200/80' },
  high: { label: 'High confidence', cls: 'text-emerald-200/80' },
};

// --- Sub-components --------------------------------------------------------

function SeverityBadge({ severity }) {
  const meta = SEVERITY_META[severity] || SEVERITY_META.LOW;
  return (
    <span
      className={
        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ring-1 ' +
        meta.chip
      }
      aria-label={`Severity ${meta.label}`}
    >
      <span className={'h-2 w-2 rounded-full ' + meta.dot} aria-hidden="true" />
      {meta.label} · {meta.bn}
    </span>
  );
}

function SectionCard({ title, bn, icon, children, accent = 'text-cyan-200' }) {
  return (
    <div className="rounded-xl bg-white/5 border border-white/10 p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className={accent} aria-hidden="true">
          {icon}
        </span>
        <h4 className={'text-xs font-bold uppercase tracking-wider ' + accent}>
          {title}
          <span className="ml-1.5 text-[10px] font-medium text-sky-100/60 normal-case tracking-normal">
            {bn}
          </span>
        </h4>
      </div>
      <div className="text-sm text-sky-50/95 leading-relaxed">{children}</div>
    </div>
  );
}

function BulletList({ items }) {
  if (!items || items.length === 0) {
    return <p className="text-sky-100/60 italic">No items provided.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <span
            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300"
            aria-hidden="true"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Spinner() {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10">
      <div className="relative h-14 w-14">
        <div className="absolute inset-0 rounded-full border-4 border-white/15" />
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-cyan-300 border-r-sky-300 animate-spin" />
        <div className="absolute inset-2 rounded-full bg-gradient-to-br from-sky-400/30 to-cyan-400/30 blur-md" />
      </div>
      <p className="mt-5 text-sm font-semibold text-white">
        Analyzing clinical data…
      </p>
      <p className="mt-1 text-xs text-sky-100/70 max-w-xs">
        Gemini is reasoning over vitals, voice symptoms, and the document scan.
      </p>
    </div>
  );
}

function ErrorState({ message }) {
  return (
    <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-50">
      <div className="flex items-start gap-3">
        <span
          className="h-7 w-7 shrink-0 rounded-full bg-rose-500 text-white grid place-items-center shadow-sm"
          aria-hidden="true"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </span>
        <div>
          <p className="font-semibold text-white">Triage request failed</p>
          <p className="mt-1 text-rose-100/90">{message}</p>
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex items-start gap-3">
      <div className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-cyan-400 to-sky-400 grid place-items-center text-slate-900 font-bold">
        AI
      </div>
      <div className="rounded-2xl rounded-tl-sm bg-white/10 px-4 py-3 text-sm leading-relaxed text-sky-50">
        <p className="font-medium text-white">Ready when you are.</p>
        <p className="mt-1 text-sky-100/80">
          Enter vitals on the left, then tap{' '}
          <span className="font-semibold text-cyan-200">Process Triage Request</span>{' '}
          to receive a color-coded triage verdict, differential diagnoses, and first-aid steps.
        </p>
      </div>
    </div>
  );
}

// --- Main export ----------------------------------------------------------

export default function TriageResult({ state }) {
  const status = state?.status || 'idle';

  if (status === 'loading') {
    return <Spinner />;
  }

  if (status === 'error') {
    return <ErrorState message={state?.error || 'Unknown error.'} />;
  }

  if (status === 'success' && state?.verdict) {
    const v = state.verdict;
    const meta = SEVERITY_META[v.severity] || SEVERITY_META.LOW;
    const conf = CONFIDENCE_META[v.confidence] || CONFIDENCE_META.low;
    return (
      <div className="space-y-3">
        {/* Severity banner */}
        <div
          className={
            'rounded-xl bg-gradient-to-br ring-1 p-4 ' + meta.banner
          }
        >
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <SeverityBadge severity={v.severity} />
            <span className={'text-xs font-semibold ' + conf.cls}>
              {conf.label}
            </span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-white/95">
            {v.summary || 'No summary provided.'}
          </p>
        </div>

        <SectionCard
          title="Possible conditions"
          bn="সম্ভাব্য রোগ"
          accent={meta.accent}
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
          }
        >
          <BulletList items={v.possible_conditions} />
        </SectionCard>

        <SectionCard
          title="Recommended actions"
          bn="প্রাথমিক পদক্ষেপ"
          accent={meta.accent}
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          }
        >
          <BulletList items={v.recommended_actions} />
        </SectionCard>

        <SectionCard
          title="Referral"
          bn="রেফারেল"
          accent={meta.accent}
          icon={
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M3 12h18M3 12l4-4M3 12l4 4M21 12l-4-4M21 12l-4 4" />
            </svg>
          }
        >
          <p>{v.referral || 'No referral guidance provided.'}</p>
        </SectionCard>
      </div>
    );
  }

  return <EmptyState />;
}
