// Shuruksha Link — Emergency Override card (Step 22)
// Renders a red, high-contrast banner when the offline emergency rules
// engine has fired. Shown above the AI verdict so the CHW sees the
// override first, even when Gemini returns successfully.

export default function EmergencyOverrideCard({ override }) {
  if (!override || !override.triggered) return null;

  const reasons = Array.isArray(override.reasons) ? override.reasons : [];
  const firstAid = Array.isArray(override.firstAid) ? override.firstAid : [];

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="emergency-override"
      className="rounded-2xl border-2 border-rose-500 bg-rose-50 ring-1 ring-rose-200 p-4 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          <div className="h-9 w-9 rounded-full bg-rose-600 text-white flex items-center justify-center font-bold">
            !
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-600 text-white uppercase tracking-wide">
              Emergency Override
            </span>
            <span className="text-sm font-semibold text-rose-900">
              CRITICAL — Life-threatening findings
            </span>
          </div>
          <p className="mt-1 text-sm text-rose-800">
            Offline rule engine has fired. AI verdict (if any) is advisory
            only.
          </p>

          {reasons.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                Reasons
              </div>
              <ul className="mt-1 space-y-1 text-sm text-rose-900 list-disc list-inside">
                {reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {firstAid.length > 0 && (
            <div className="mt-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                Immediate first aid
              </div>
              <ul className="mt-1 space-y-1 text-sm text-rose-900 list-disc list-inside">
                {firstAid.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}

          {override.referral && (
            <div className="mt-3 rounded-lg bg-rose-600 text-white px-3 py-2 text-sm font-semibold">
              Referral: {override.referral}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
