import { useMemo } from 'react';
import { checkVitals } from '../utils/checkVitals.js';
import VoiceCapture from './VoiceCapture.jsx';
import DocumentScan from './DocumentScan.jsx';

// Field definitions drive both the form layout and the checkVitals keys,
// so adding a new metric only requires editing this array.
const FIELDS = [
  {
    key: 'bp',
    label: 'Blood Pressure',
    bn: 'রক্তচাপ',
    type: 'text',
    placeholder: '120/80',
    unit: 'mmHg',
    hint: 'Systolic/Diastolic',
  },
  {
    key: 'heartRate',
    label: 'Heart Rate',
    bn: 'হৃদস্পন্দন',
    type: 'number',
    placeholder: '72',
    unit: 'bpm',
    min: 0,
    max: 250,
  },
  {
    key: 'temperature',
    label: 'Temperature',
    bn: 'শরীরের তাপমাত্রা',
    type: 'number',
    placeholder: '37.0',
    unit: '°C',
    step: '0.1',
    min: 25,
    max: 45,
  },
  {
    key: 'oxygen',
    label: 'SpO2',
    bn: 'অক্সিজেন স্যাচুরেশন',
    type: 'number',
    placeholder: '98',
    unit: '%',
    min: 0,
    max: 100,
  },
  {
    key: 'glucose',
    label: 'Blood Glucose',
    bn: 'রক্তে শর্করা',
    type: 'number',
    placeholder: '110',
    unit: 'mg/dL',
    min: 0,
    max: 700,
  },
];

export default function VitalsForm({ vitals, onChange }) {
  // Recompute alerts whenever any field changes. With 5 inputs this is
  // cheap enough to run on every keystroke.
  const alerts = useMemo(() => checkVitals(vitals), [vitals]);

  const handleField = (key) => (e) => {
    onChange({ ...vitals, [key]: e.target.value });
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
          <div className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-sky-700 ring-1 ring-sky-200/60">
            Step 1
          </div>
          <h2 className="mt-2.5 text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
            Vitals Intake
            <span className="ml-2 text-base font-medium text-slate-500">
              / ভাইটালস্
            </span>
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Enter the patient's current measurements. Alerts appear instantly.
          </p>
        </div>
        <div className="hidden sm:flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-cyan-500 text-white shadow-md shadow-sky-500/30">
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
            <path d="M3 12h3l2-7 4 14 2-7h7" />
          </svg>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
        {FIELDS.map((field) => (
          <label
            key={field.key}
            className={`flex flex-col gap-1.5 ${
              field.key === 'bp' ? 'sm:col-span-2' : ''
            }`}
          >
            <span className="text-sm font-semibold text-slate-700">
              {field.label}
              <span className="ml-1.5 text-xs font-normal text-slate-500">
                {field.bn}
              </span>
            </span>

            <div className="relative">
              <input
                type={field.type}
                inputMode={field.type === 'number' ? 'decimal' : undefined}
                value={vitals[field.key] ?? ''}
                onChange={handleField(field.key)}
                placeholder={field.placeholder}
                min={field.min}
                max={field.max}
                step={field.step}
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
                aria-label={field.label}
              />
              {field.unit && (
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-semibold text-slate-500 peer-focus:text-sky-600 transition-colors">
                  {field.unit}
                </span>
              )}
            </div>

            {field.hint && (
              <span className="text-xs text-slate-500">{field.hint}</span>
            )}
          </label>
        ))}
      </div>

      {/* Live alerts panel */}
      <div className="mt-7 pt-6 border-t border-slate-200/80">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-2">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4 text-sky-600"
              aria-hidden="true"
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Anomaly Alerts
          </h3>
          <span
            className={
              'text-xs font-semibold px-2.5 py-1 rounded-full inline-flex items-center gap-1.5 ' +
              (alerts.length === 0
                ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200'
                : 'bg-rose-100 text-rose-700 ring-1 ring-rose-200')
            }
          >
            <span
              className={
                'h-1.5 w-1.5 rounded-full ' +
                (alerts.length === 0 ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse')
              }
              aria-hidden="true"
            />
            {alerts.length === 0
              ? 'All values normal'
              : `${alerts.length} alert${alerts.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {alerts.length === 0 ? (
          <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 px-4 py-3.5 text-sm font-medium text-emerald-800 flex items-center gap-3 shadow-sm">
            <span className="h-7 w-7 shrink-0 rounded-full bg-emerald-500 text-white grid place-items-center shadow-sm shadow-emerald-500/30">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <span>No anomalies detected in the entered values.</span>
          </div>
        ) : (
          <ul className="space-y-2" role="alert">
            {alerts.map((msg, i) => (
              <li
                key={i}
                className="
                  flex items-start gap-3
                  rounded-xl border border-rose-200
                  bg-gradient-to-br from-rose-50 to-orange-50
                  px-4 py-3 text-sm font-medium text-rose-900
                  shadow-sm shadow-rose-900/5
                "
              >
                <span
                  className="
                    h-7 w-7 shrink-0 rounded-full
                    bg-rose-500 text-white
                    grid place-items-center
                    shadow-sm shadow-rose-500/30
                  "
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
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </span>
                <span className="pt-0.5">{msg}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <VoiceCapture />
      <DocumentScan />
    </section>
  );
}
