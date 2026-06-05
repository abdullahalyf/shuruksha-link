// VoiceCapture — UI for the Web Speech Recognition API.
// Self-contained: uses the useSpeechRecognition hook for all state.
// Optional props:
//   `onTranscriptChange(value)` keeps the parent in sync so the triage
//   engine, Gemini request, case history, and PDF all consume the
//   latest text. The component exposes a unified symptoms input: the
//   user can speak OR type into the same textarea. Voice-recognized
//   text is appended to whatever the user has typed; manual edits
//   are never overwritten.

import { useEffect, useRef, useState } from 'react';
import { SUPPORTED_LANGS, useSpeechRecognition } from '../hooks/useSpeechRecognition.js';

export default function VoiceCapture({ onTranscriptChange }) {
  const [lang, setLang] = useState('en-US');
  const {
    supported,
    isListening,
    transcript,
    interim,
    error,
    start,
    stop,
    reset,
    setLang: applyLang,
  } = useSpeechRecognition({ lang });

  // Unified symptoms buffer. This is the single source of truth for the
  // parent — voice recognition appends into it, the user types into it.
  const [text, setText] = useState('');
  // Track what we've already consumed from the hook so we can compute
  // the delta on each new transcript update.
  const lastHookTranscriptRef = useRef('');
  // Pause appending while the user is actively typing, so we don't yank
  // the caret out from under them. The interim word is still surfaced
  // via a separate live-status line below the textarea.
  const textareaRef = useRef(null);

  // Keep the parent in sync on every edit (typing OR voice append).
  useEffect(() => {
    if (typeof onTranscriptChange === 'function') {
      onTranscriptChange(text);
    }
  }, [text, onTranscriptChange]);

  // When the hook emits a new final-transcript value, append the delta
  // into the unified buffer. We never clobber text the user typed.
  useEffect(() => {
    if (!transcript) {
      lastHookTranscriptRef.current = '';
      return;
    }
    const previous = lastHookTranscriptRef.current;
    if (transcript === previous) return;

    // Compute the new tail the hook added since we last looked.
    let delta = '';
    if (transcript.startsWith(previous)) {
      delta = transcript.slice(previous.length);
    } else {
      // The hook rewound (e.g. user changed language). Treat the whole
      // transcript as the new chunk.
      delta = transcript;
    }
    lastHookTranscriptRef.current = transcript;

    if (!delta) return;

    setText((current) => {
      if (!current) return current + delta;
      // If the buffer doesn't end with whitespace and the delta doesn't
      // start with punctuation, insert a single space so the merged
      // text reads naturally.
      const needsSpace =
        !/\s$/.test(current) &&
        !/^[\s.,;:!?]/.test(delta);
      return current + (needsSpace ? ' ' : '') + delta;
    });
  }, [transcript]);

  const handleLangChange = (e) => {
    const next = e.target.value;
    setLang(next);
    applyLang(next);
  };

  const handleTextareaChange = (e) => {
    setText(e.target.value);
  };

  const handleClear = () => {
    setText('');
    lastHookTranscriptRef.current = '';
    reset();
  };

  // Not supported — render a graceful, non-broken panel.
  if (!supported) {
    return (
      <div
        className="
          mt-6 rounded-xl border border-amber-200
          bg-gradient-to-br from-amber-50 to-orange-50
          p-4 sm:p-5 text-sm text-amber-900 shadow-sm
          flex items-start gap-3
        "
        role="status"
      >
        <span
          className="
            h-7 w-7 shrink-0 rounded-full
            bg-amber-500 text-white
            grid place-items-center shadow-sm shadow-amber-500/30
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
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </span>
        <div>
          <p className="font-semibold">Voice input not supported in this browser.</p>
          <p className="mt-1 text-amber-800/90">
            Please use the latest version of Chrome, Edge, or Safari on desktop or Android to enable
            microphone-based symptom capture. You can still type vitals above.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="
        mt-6 rounded-xl border border-sky-200/70
        bg-gradient-to-br from-sky-50/60 to-cyan-50/60
        p-4 sm:p-5 shadow-sm
      "
    >
      {/* Header row: label + language selector */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`
              h-2.5 w-2.5 rounded-full transition-colors
              ${isListening ? 'bg-rose-500 animate-pulse' : 'bg-slate-300'}
            `}
            aria-hidden="true"
          />
          <h3 className="text-sm font-semibold text-slate-800 uppercase tracking-wide">
            Symptoms Input
            <span className="ml-1.5 text-xs font-normal text-slate-500 normal-case">
              / লক্ষণ বলুন বা লিখুন
            </span>
          </h3>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="voice-lang" className="text-xs font-semibold text-slate-600">
            Language
          </label>
          <select
            id="voice-lang"
            value={lang}
            onChange={handleLangChange}
            disabled={false}
            className="
              h-10 px-3 pr-8 rounded-lg
              text-sm font-medium text-slate-800
              bg-white border border-slate-300
              shadow-sm shadow-slate-900/[0.02]
              focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500
              transition-colors
            "
          >
            {SUPPORTED_LANGS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Mic button + status */}
      <div className="mt-4 flex items-center gap-3 sm:gap-4 flex-wrap">
        <button
          type="button"
          onClick={isListening ? stop : start}
          aria-pressed={isListening}
          aria-label={isListening ? 'Stop listening' : 'Start listening'}
          className={`
            relative h-14 px-5 sm:px-6 rounded-xl
            text-white font-semibold text-base
            inline-flex items-center gap-2.5
            shadow-md focus:outline-none focus:ring-4
            transition-all duration-200 active:scale-[0.98]
            ${
              isListening
                ? 'bg-gradient-to-r from-rose-600 to-red-600 shadow-rose-600/30 focus:ring-rose-300 hover:from-rose-700 hover:to-red-700'
                : 'bg-gradient-to-r from-sky-600 to-cyan-600 shadow-sky-600/30 focus:ring-sky-300 hover:from-sky-700 hover:to-cyan-700'
            }
          `}
        >
          {isListening ? (
            <>
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-75 animate-ping" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-white" />
              </span>
              Stop Listening
            </>
          ) : (
            <>
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
                <rect x="9" y="2" width="6" height="12" rx="3" />
                <path d="M5 10a7 7 0 0 0 14 0" />
                <line x1="12" y1="19" x2="12" y2="22" />
              </svg>
              Start Listening
            </>
          )}
        </button>

        {/* Live status pill */}
        <div
          className={`
            inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold
            ${
              isListening
                ? 'bg-rose-100 text-rose-700 ring-1 ring-rose-200'
                : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
            }
          `}
          aria-live="polite"
        >
          {isListening ? '● Recording…' : 'Idle'}
        </div>

        {text && (
          <button
            type="button"
            onClick={handleClear}
            className="
              h-10 px-3 rounded-lg text-xs font-semibold
              text-slate-600 bg-white border border-slate-300
              hover:bg-slate-50 hover:text-slate-900
              focus:outline-none focus:ring-2 focus:ring-sky-500
              transition-colors
            "
          >
            Clear symptoms
          </button>
        )}
      </div>

      {/* Unified symptoms textarea — user can type, speak, or both.
          The hook appends recognized final text into this same buffer;
          manual edits are never overwritten. */}
      <div className="mt-4">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextareaChange}
          rows={4}
          placeholder="Speak or type patient symptoms here..."
          aria-label="Patient symptoms (type or dictate)"
          className="
            w-full min-h-[5.5rem] resize-y
            rounded-lg border border-slate-200 bg-white/80 backdrop-blur
            p-3.5 text-sm text-slate-800 leading-relaxed
            shadow-inner shadow-slate-900/[0.02]
            placeholder:text-slate-400 placeholder:italic
            focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500
            transition-colors
          "
        />
        {isListening && interim && (
          <p className="mt-1.5 text-xs text-slate-500 italic" aria-live="polite">
            hearing: {interim}
          </p>
        )}
      </div>

      {error && (
        <p className="mt-2 text-xs font-medium text-rose-700">
          ⚠ Microphone error: {error}. Check that the browser has mic permission for this site.
        </p>
      )}
    </div>
  );
}
