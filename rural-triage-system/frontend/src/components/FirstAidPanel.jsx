// FirstAidPanel — green first-aid card shown directly under the AI verdict.
// Pure presentational. Receives:
//   - firstAid: { firstAidTitle: { en, bn }, firstAidItems: [{ en, bn }] }
//   - language: 'en' | 'bn'   (defaults to 'en')
//
// Layout (matches TriageResult's other section cards but uses a green
// accent to signal "actionable steps" vs. "diagnostic content"):
//
//   FIRST AID RECOMMENDATIONS
//   প্রাথমিক চিকিৎসা পরামর্শ
//
//   ✓ item
//   ✓ item
//   ✓ item
//
// If the parent has not generated any first-aid (e.g. no alerts fired),
// the panel renders a friendly "no specific steps — observe" message
// instead of an empty card.

const TITLE_TONE = {
  en: { chip: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30', dot: 'bg-emerald-400' },
  bn: { chip: 'bg-emerald-500/15 text-emerald-200 ring-emerald-400/30', dot: 'bg-emerald-400' },
};

const EMPTY_COPY = {
  en: {
    title: 'No specific first-aid steps',
    hint: 'No abnormal vitals or lab alerts detected. Continue routine observation.',
  },
  bn: {
    title: 'নির্দিষ্ট প্রাথমিক চিকিৎসা প্রয়োজন নেই',
    hint: 'কোনো অস্বাভাবিক লক্ষণ পাওয়া যায়নি। স্বাভাবিক পর্যবেক্ষণ চালিয়ে যান।',
  },
};

function pickText(item, language) {
  if (!item) return '';
  if (language === 'bn' && item.bn) return item.bn;
  return item.en || item.bn || '';
}

export default function FirstAidPanel({ firstAid, language = 'en' }) {
  const lang = language === 'bn' ? 'bn' : 'en';
  const tone = TITLE_TONE[lang];

  const titleEn = firstAid?.firstAidTitle?.en || 'First Aid Recommendations';
  const titleBn = firstAid?.firstAidTitle?.bn || 'প্রাথমিক চিকিৎসা পরামর্শ';
  const items = Array.isArray(firstAid?.firstAidItems) ? firstAid.firstAidItems : [];

  const hasItems = items.length > 0;

  return (
    <div
      className="
        rounded-xl
        bg-emerald-500/10
        border border-emerald-400/25
        ring-1 ring-emerald-400/20
        p-4
      "
      role="region"
      aria-label="First Aid Recommendations"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-emerald-200" aria-hidden="true">
          {/* check-circle icon */}
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
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </span>
        <h4
          className={
            'inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider ' +
            tone.chip +
            ' rounded-full px-2 py-0.5 ring-1'
          }
        >
          <span className={'h-1.5 w-1.5 rounded-full ' + tone.dot} aria-hidden="true" />
          {lang === 'bn' ? titleBn : titleEn}
          <span className="text-[10px] font-medium text-emerald-100/70 normal-case tracking-normal">
            {lang === 'bn' ? titleEn : titleBn}
          </span>
        </h4>
      </div>

      {hasItems ? (
        <ul className="space-y-1.5 text-sm text-emerald-50 leading-relaxed">
          {items.map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span
                className="mt-0.5 text-emerald-300 font-bold leading-none"
                aria-hidden="true"
              >
                ✓
              </span>
              <span>{pickText(item, lang)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-emerald-50/90 leading-relaxed">
          <p className="font-semibold">{EMPTY_COPY[lang].title}</p>
          <p className="mt-1 text-emerald-100/80 italic">{EMPTY_COPY[lang].hint}</p>
        </div>
      )}
    </div>
  );
}
