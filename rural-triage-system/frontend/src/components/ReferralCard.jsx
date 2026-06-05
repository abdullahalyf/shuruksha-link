// Shuruksha Link — Referral Plan card (Step 23)
// Renders the structured referral directory output (facility, urgency,
// transport, transfer checklist) inside the AI Assistant panel.
//
// Sits below the Emergency Override banner (if any) and the severity
// strip so the CHW sees the override first, then the structured plan.
// Returns null when no plan is supplied so the panel stays clean.

const LEVEL_META = {
  EMERGENCY: {
    label: 'EMERGENCY',
    bn: 'জরুরি',
    chip: 'bg-rose-500/20 text-rose-100 ring-rose-400/40',
    accent: 'text-rose-100',
    dot: 'bg-rose-300',
  },
  CRITICAL: {
    label: 'CRITICAL',
    bn: 'গুরুতর',
    chip: 'bg-rose-500/15 text-rose-100 ring-rose-400/30',
    accent: 'text-rose-100',
    dot: 'bg-rose-300',
  },
  HIGH: {
    label: 'HIGH',
    bn: 'উচ্চ',
    chip: 'bg-orange-500/15 text-orange-100 ring-orange-400/30',
    accent: 'text-orange-100',
    dot: 'bg-orange-300',
  },
  MEDIUM: {
    label: 'MEDIUM',
    bn: 'মাঝারি',
    chip: 'bg-amber-500/15 text-amber-100 ring-amber-400/30',
    accent: 'text-amber-100',
    dot: 'bg-amber-300',
  },
  LOW: {
    label: 'LOW',
    bn: 'কম',
    chip: 'bg-emerald-500/15 text-emerald-100 ring-emerald-400/30',
    accent: 'text-emerald-100',
    dot: 'bg-emerald-300',
  },
};

function MetaRow({ label, bn, value, accent = 'text-cyan-200' }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <div className="w-24 shrink-0 text-sky-100/70">
        <div className="font-semibold">{label}</div>
        <div className="text-[10px] text-sky-100/50 normal-case tracking-normal">
          {bn}
        </div>
      </div>
      <div className={'flex-1 font-semibold leading-snug ' + accent}>
        {value || '—'}
      </div>
    </div>
  );
}

export default function ReferralCard({ plan }) {
  if (!plan || typeof plan !== 'object') return null;
  const meta = LEVEL_META[plan.level] || LEVEL_META.LOW;
  const checklist = Array.isArray(plan.checklist) ? plan.checklist : [];

  return (
    <div
      data-testid="referral-card"
      className="rounded-xl border border-white/15 bg-white/5 backdrop-blur p-4 space-y-3"
    >
      {/* Header strip: tier badge + bilingual title */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={
              'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ring-1 ' +
              meta.chip
            }
            aria-label={'Referral level ' + meta.label}
          >
            <span className={'h-2 w-2 rounded-full ' + meta.dot} aria-hidden="true" />
            {meta.label} · {meta.bn}
          </span>
          <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-200">
            Referral Plan
            <span className="ml-1.5 text-[10px] font-medium text-sky-100/60 normal-case tracking-normal">
              রেফারেল পরিকল্পনা
            </span>
          </h4>
        </div>
      </div>

      {/* Facility / urgency / transport rows */}
      <div className="space-y-2">
        <MetaRow
          label="Facility"
          bn="প্রতিষ্ঠান"
          value={plan.facilityType}
          accent="text-white"
        />
        <MetaRow
          label="Urgency"
          bn="জরুরিতা"
          value={plan.urgency}
          accent={meta.accent}
        />
        <MetaRow
          label="Transport"
          bn="পরিবহন"
          value={plan.transportation}
          accent="text-sky-50"
        />
      </div>

      {/* Recommendation paragraph */}
      {plan.recommendation && (
        <p className="text-sm leading-relaxed text-sky-50/95 border-l-2 border-cyan-300/60 pl-3">
          {plan.recommendation}
        </p>
      )}

      {/* Transfer checklist */}
      {checklist.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-200">
            Transfer Checklist
            <span className="ml-1.5 text-[9px] font-medium text-sky-100/60 normal-case tracking-normal">
              স্থানান্তর চেকলিস্ট
            </span>
          </div>
          <ul className="mt-1.5 space-y-1.5">
            {checklist.map((item, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm text-sky-50/95"
              >
                <span
                  className="mt-0.5 text-cyan-300 font-bold leading-none"
                  aria-hidden="true"
                >
                  ✓
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
