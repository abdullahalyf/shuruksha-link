// Shuruksha Link — Frontend root component
// Layout: gradient header → status pill → 2-column dashboard (Phase 3).
// Vitals module is wired; voice, OCR, and Gemini features are not yet built.

import { useEffect, useState } from 'react';
import VitalsForm from './components/VitalsForm.jsx';

const EMPTY_VITALS = {
  bp: '',
  heartRate: '',
  temperature: '',
  oxygen: '',
  glucose: '',
};

// Status pill metadata — kept here so the dot/text colors stay in sync.
function getStatusMeta(message) {
  if (message === 'checking…') {
    return { tone: 'checking', dot: 'bg-amber-400 animate-pulse', text: 'text-amber-700', chip: 'bg-amber-50 border-amber-200' };
  }
  if (message.startsWith('Backend') || message === 'connected') {
    return { tone: 'online', dot: 'bg-emerald-500', text: 'text-emerald-700', chip: 'bg-emerald-50 border-emerald-200' };
  }
  return { tone: 'offline', dot: 'bg-rose-500', text: 'text-rose-700', chip: 'bg-rose-50 border-rose-200' };
}

export default function App() {
  const [apiStatus, setApiStatus] = useState('checking…');
  const [vitals, setVitals] = useState(EMPTY_VITALS);
  const status = getStatusMeta(apiStatus);

  useEffect(() => {
    // Smoke test: confirm the backend is reachable
    fetch('http://localhost:5000/')
      .then((res) => res.json())
      .then((data) => setApiStatus(data.message || 'connected'))
      .catch(() => setApiStatus('unreachable (is the backend running on :5000?)'));
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-sky-50 to-cyan-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">

        {/* App header — brand bar */}
        <header className="mb-6 sm:mb-8 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-sky-600 to-cyan-600 text-white grid place-items-center shadow-lg shadow-sky-600/20">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6"
                aria-hidden="true"
              >
                <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                Shuruksha Link
              </h1>
              <p className="text-sm sm:text-base text-slate-600">
                Rural triage workstation · <span className="text-slate-500">চিকিৎসা সহায়তা</span>
              </p>
            </div>
          </div>

          {/* Status pill */}
          <div
            className={
              'inline-flex items-center gap-2.5 rounded-full border px-3.5 py-1.5 shadow-sm ' +
              status.chip
            }
            aria-live="polite"
          >
            <span className={'h-2.5 w-2.5 rounded-full ' + status.dot} aria-hidden="true" />
            <span className={'text-xs sm:text-sm font-semibold ' + status.text}>
              API {status.tone === 'online' ? 'Online' : status.tone === 'checking' ? 'Checking…' : 'Offline'}
            </span>
            <span className="hidden sm:inline text-xs text-slate-500 max-w-[16rem] truncate">
              {apiStatus}
            </span>
          </div>
        </header>

        {/* Two-column dashboard: left = intake, right = AI assistant panel */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <div className="lg:col-span-3 space-y-6">
            <VitalsForm vitals={vitals} onChange={setVitals} />

            <button
              type="button"
              onClick={() => { /* wired in a later step */ }}
              className="
                w-full h-14 sm:h-16
                rounded-2xl
                bg-gradient-to-r from-sky-600 to-cyan-600
                hover:from-sky-700 hover:to-cyan-700
                active:scale-[0.99]
                text-white text-lg sm:text-xl font-bold tracking-wide
                shadow-lg shadow-sky-600/25 hover:shadow-xl hover:shadow-sky-600/30
                focus:outline-none focus:ring-4 focus:ring-sky-300
                transition-all duration-200
                flex items-center justify-center gap-3
              "
              aria-label="Process Triage Request"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-6 w-6"
                aria-hidden="true"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
              Process Triage Request
              <span className="text-sm sm:text-base font-medium opacity-80">
                / ট্রায়াজ শুরু করুন
              </span>
            </button>
          </div>

          <aside className="lg:col-span-2">
            <section
              className="
                h-full min-h-[24rem] lg:min-h-[36rem]
                relative overflow-hidden
                rounded-2xl
                bg-gradient-to-br from-slate-900 via-sky-900 to-cyan-900
                text-white
                shadow-xl shadow-sky-900/20
                border border-slate-800
                p-6 sm:p-7
                flex flex-col
              "
            >
              {/* Decorative blurred orbs for depth */}
              <div className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full bg-cyan-400/20 blur-3xl" aria-hidden="true" />
              <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-sky-400/20 blur-3xl" aria-hidden="true" />

              <div className="relative">
                <div className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur px-3 py-1 text-xs font-semibold uppercase tracking-wider text-cyan-200 ring-1 ring-white/15">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 animate-pulse" aria-hidden="true" />
                  AI Assistant
                </div>
                <h2 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight">
                  Triage Output
                </h2>
                <p className="mt-1 text-sm text-sky-100/80">
                  Gemini reasoning, voice transcript, and document scan will appear here.
                </p>
              </div>

              <div className="relative mt-8 flex-1 rounded-xl border border-white/10 bg-white/5 backdrop-blur p-5 flex flex-col">
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

                <ul className="mt-6 space-y-2.5 text-sm text-sky-100/90">
                  <li className="flex items-center gap-2.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" aria-hidden="true" />
                    Color-coded safety verdict
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" aria-hidden="true" />
                    Differential diagnoses
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" aria-hidden="true" />
                    Localized first-aid steps
                  </li>
                  <li className="flex items-center gap-2.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" aria-hidden="true" />
                    Physician referral timeline
                  </li>
                </ul>

                <div className="mt-auto pt-6 text-xs text-sky-100/60">
                  Phase 3 · Triage reasoning will be wired in Step 11.
                </div>
              </div>
            </section>
          </aside>
        </div>

        <footer className="mt-8 text-center text-xs text-slate-500">
          Shuruksha Link · Step 1: Vitals Intake · Built for Community Health Workers
        </footer>
      </div>
    </div>
  );
}
