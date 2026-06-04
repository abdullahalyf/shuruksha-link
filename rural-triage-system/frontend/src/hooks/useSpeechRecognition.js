// useSpeechRecognition — thin React wrapper around the Web Speech API.
// Why a hook: the recognition object is stateful (continuous stream,
// interim vs. final results, restart-on-end), so keeping that logic out
// of the form component is the difference between a clean panel and
// a 200-line spaghetti block.

import { useCallback, useEffect, useRef, useState } from 'react';

// Detect the browser-prefixed constructor without crashing on SSR / Firefox.
function getSpeechCtor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export const SUPPORTED_LANGS = [
  { code: 'en-US', label: 'English', bn: 'ইংরেজি' },
  { code: 'bn-BD', label: 'বাংলা (Bangla)', bn: 'বাংলা' },
];

/**
 * @param {object} options
 * @param {string} options.lang - BCP-47 tag, e.g. "en-US" or "bn-BD"
 * @param {boolean} [options.continuous=true] - keep listening after each phrase
 * @param {boolean} [options.interimResults=true] - stream partial transcripts
 */
export function useSpeechRecognition({ lang = 'en-US', continuous = true, interimResults = true } = {}) {
  const Ctor = getSpeechCtor();
  const supported = Boolean(Ctor);

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState(null);

  const recognitionRef = useRef(null);
  // Keep the latest language in a ref so the auto-restart uses fresh values.
  const langRef = useRef(lang);
  useEffect(() => { langRef.current = lang; }, [lang]);

  // Build the recognition instance once.
  useEffect(() => {
    if (!Ctor) return undefined;
    const rec = new Ctor();
    rec.continuous = continuous;
    rec.interimResults = interimResults;
    rec.lang = langRef.current;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let finalChunk = '';
      let interimChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalChunk += result[0].transcript;
        else interimChunk += result[0].transcript;
      }
      if (finalChunk) {
        setTranscript((prev) => (prev ? prev + ' ' : '') + finalChunk.trim());
        setInterim('');
      } else if (interimChunk) {
        setInterim(interimChunk);
      }
    };

    rec.onerror = (event) => {
      // 'no-speech' and 'aborted' are common during normal stop flows.
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        setError(event.error || 'speech-error');
      }
      setIsListening(false);
    };

    rec.onend = () => {
      // Some browsers auto-stop after a pause; resurface that as "ended".
      setIsListening(false);
    };

    recognitionRef.current = rec;
    return () => {
      try { rec.abort(); } catch { /* noop */ }
      recognitionRef.current = null;
    };
  // We intentionally build the instance once; runtime config is patched
  // via the setter helpers below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Ctor]);

  const start = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    setError(null);
    setInterim('');
    try {
      rec.lang = langRef.current;
      rec.start();
      setIsListening(true);
    } catch (e) {
      // start() throws if called while already started — treat as no-op.
      setIsListening(recognitionRef.current != null);
    }
  }, []);

  const stop = useCallback(() => {
    const rec = recognitionRef.current;
    if (!rec) return;
    try { rec.stop(); } catch { /* noop */ }
    setIsListening(false);
    setInterim('');
  }, []);

  const reset = useCallback(() => {
    stop();
    setTranscript('');
    setInterim('');
    setError(null);
  }, [stop]);

  const setLang = useCallback((nextLang) => {
    langRef.current = nextLang;
    const rec = recognitionRef.current;
    if (rec) rec.lang = nextLang;
    // If we're actively listening, restart so the new language takes effect.
    setIsListening((wasListening) => {
      if (wasListening && rec) {
        try { rec.stop(); } catch { /* noop */ }
        // onend will fire; start again on the next tick.
        setTimeout(() => {
          try { rec.start(); setIsListening(true); } catch { /* noop */ }
        }, 120);
      }
      return wasListening;
    });
  }, []);

  return {
    supported,
    isListening,
    transcript,
    interim,
    error,
    start,
    stop,
    reset,
    setLang,
  };
}
