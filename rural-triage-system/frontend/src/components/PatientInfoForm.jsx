// Shuruksha Link — Patient Information card
// Sits above the Vitals Intake card on the left column. Captures the
// basic demographics that every hospital triage form asks for (name,
// age, gender, phone, address) so the same record flows through:
//   - the Gemini prompt (age + gender sharpen the differential),
//   - the case history (saved + restored with every other field),
//   - the physician PDF (printed as a dedicated section on page 1),
//   - the TriageResult header (compact one-liner above the banner).
//
// Required : name, age, gender (the Process button is allowed to fire
//            even when these are blank, but the field-level asterisks
//            make the requirement visible to the CHW).
// Optional : phone, address.
//
// Age validation is bounded 0–120. Phone is free text (Bangladeshi
// numbers vary in format, and some CHWs write village-landline strings).

import { useMemo } from 'react';

const GENDERS = [
  { value: '',         label: 'Select…',     disabled: true },
  { value: 'Male',     label: 'Male' },
  { value: 'Female',   label: 'Female' },
  { value: 'Other',    label: 'Other' },
];

// One pass over the patient object → flat list of field-level errors
// used to render the small red helper text under each input.
function validate(patient) {
  const errors = {};
  if (!patient.name || !patient.name.trim()) {
    errors.name = 'Required';
  }
  const ageStr = String(patient.age ?? '').trim();
  if (ageStr === '') {
    errors.age = 'Required';
  } else {
    const n = Number(ageStr);
    if (!Number.isFinite(n) || n < 0 || n > 120) {
      errors.age = 'Age must be 0–120';
    }
  }
  if (!patient.gender) {
    errors.gender = 'Required';
  }
  return errors;
}

export default function PatientInfoForm({ patient, onChange }) {
  const errors = useMemo(() => validate(patient), [patient]);

  const handle = (key) => (e) => {
    onChange({ ...patient, [key]: e.target.value });
  };

  return (
    <section
      className="
        bg-white rounded-2xl
        shadow-lg shadow-sky-900/5
        border border-slate-200/80
        p-5 sm:p-7
        ring-1 ring-slate-900/[0.02]
      "
    >
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-700 ring-1 ring-emerald-200/60">
            Step 0
          </div>
          <h2 className="mt-2.5 text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Patient Information
            <span className="ml-2 text-base font-medium text-slate-500">
              / রোগীর তথ্য
            </span>
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Register the patient before recording vitals. Fields marked
            <span className="text-rose-600 font-semibold"> *</span> are required.
          </p>
        </div>
        <div className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-md shadow-emerald-500/30">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
        {/* Patient Name — full width on its own row */}
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-sm font-semibold text-slate-700">
            Patient Name
            <span className="ml-1.5 text-xs font-normal text-slate-500">
              রোগীর নাম
            </span>
            <span className="ml-1 text-rose-600 font-bold" aria-hidden="true">*</span>
          </span>
          <input
            type="text"
            value={patient.name ?? ''}
            onChange={handle('name')}
            placeholder="e.g. Anwara Begum"
            aria-label="Patient name"
            aria-required="true"
            className="
              w-full h-12 px-4
              text-base text-slate-900 font-medium
              bg-slate-50 border border-slate-300 rounded-xl
              placeholder:text-slate-400 placeholder:font-normal
              shadow-sm shadow-slate-900/[0.02]
              focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500
              focus:bg-white focus:shadow-md focus:shadow-sky-500/10
              transition-all duration-150
            "
          />
          {errors.name && (
            <span className="text-xs font-medium text-rose-600">
              {errors.name}
            </span>
          )}
        </label>

        {/* Age */}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-slate-700">
            Age
            <span className="ml-1.5 text-xs font-normal text-slate-500">
              বয়স
            </span>
            <span className="ml-1 text-rose-600 font-bold" aria-hidden="true">*</span>
          </span>
          <div className="relative">
            <input
              type="number"
              inputMode="numeric"
              value={patient.age ?? ''}
              onChange={handle('age')}
              placeholder="0–120"
              min={0}
              max={120}
              aria-label="Age in years"
              aria-required="true"
              className="
                peer w-full h-12 px-4 pr-14
                text-base text-slate-900 font-medium
                bg-slate-50 border border-slate-300 rounded-xl
                placeholder:text-slate-400 placeholder:font-normal
                shadow-sm shadow-slate-900/[0.02]
                focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500
                focus:bg-white focus:shadow-md focus:shadow-sky-500/10
                transition-all duration-150
              "
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-slate-500 peer-focus:text-sky-600 transition-colors">
              years
            </span>
          </div>
          {errors.age && (
            <span className="text-xs font-medium text-rose-600">
              {errors.age}
            </span>
          )}
        </label>

        {/* Gender */}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-slate-700">
            Gender
            <span className="ml-1.5 text-xs font-normal text-slate-500">
              লিঙ্গ
            </span>
            <span className="ml-1 text-rose-600 font-bold" aria-hidden="true">*</span>
          </span>
          <div className="relative">
            <select
              value={patient.gender ?? ''}
              onChange={handle('gender')}
              aria-label="Gender"
              aria-required="true"
              className="
                peer w-full h-12 px-4 pr-10
                text-base text-slate-900 font-medium
                bg-slate-50 border border-slate-300 rounded-xl
                placeholder:text-slate-400 placeholder:font-normal
                shadow-sm shadow-slate-900/[0.02]
                focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500
                focus:bg-white focus:shadow-md focus:shadow-sky-500/10
                transition-all duration-150
                appearance-none
              "
            >
              {GENDERS.map((g) => (
                <option key={g.value} value={g.value} disabled={g.disabled}>
                  {g.label}
                </option>
              ))}
            </select>
            <span
              className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-500 peer-focus:text-sky-600 transition-colors"
              aria-hidden="true"
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
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </div>
          {errors.gender && (
            <span className="text-xs font-medium text-rose-600">
              {errors.gender}
            </span>
          )}
        </label>

        {/* Phone — optional */}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-slate-700">
            Phone Number
            <span className="ml-1.5 text-xs font-normal text-slate-500">
              ফোন নম্বর
            </span>
            <span className="ml-1.5 text-[10px] uppercase tracking-wider font-semibold text-slate-400">
              optional
            </span>
          </span>
          <input
            type="text"
            inputMode="tel"
            value={patient.phone ?? ''}
            onChange={handle('phone')}
            placeholder="01XXXXXXXXX"
            aria-label="Phone number"
            className="
              w-full h-12 px-4
              text-base text-slate-900 font-medium
              bg-slate-50 border border-slate-300 rounded-xl
              placeholder:text-slate-400 placeholder:font-normal
              shadow-sm shadow-slate-900/[0.02]
              focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500
              focus:bg-white focus:shadow-md focus:shadow-sky-500/10
              transition-all duration-150
            "
          />
        </label>

        {/* Address — optional */}
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-slate-700">
            Village / Address
            <span className="ml-1.5 text-xs font-normal text-slate-500">
              গ্রাম / ঠিকানা
            </span>
            <span className="ml-1.5 text-[10px] uppercase tracking-wider font-semibold text-slate-400">
              optional
            </span>
          </span>
          <input
            type="text"
            value={patient.address ?? ''}
            onChange={handle('address')}
            placeholder="e.g. Vill. Charpara, P.O. Matlab"
            aria-label="Village or address"
            className="
              w-full h-12 px-4
              text-base text-slate-900 font-medium
              bg-slate-50 border border-slate-300 rounded-xl
              placeholder:text-slate-400 placeholder:font-normal
              shadow-sm shadow-slate-900/[0.02]
              focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500
              focus:bg-white focus:shadow-md focus:shadow-sky-500/10
              transition-all duration-150
            "
          />
        </label>
      </div>
    </section>
  );
}
