import { useCallback, useEffect, useRef, useState } from 'react';
import Tesseract from 'tesseract.js';

// Recognized input MIME types — matches the upload accept attribute.
export const ACCEPTED_TYPES = ['image/jpeg', 'image/jpg', 'image/png'];
export const ACCEPTED_EXTENSIONS = '.jpg,.jpeg,.png';
const MAX_FILE_SIZE_MB = 10;

/**
 * useOCR — thin React wrapper around Tesseract.js.
 *
 * Returns:
 *   status     : 'idle' | 'loading' | 'recognizing' | 'done' | 'error'
 *   progress   : 0..1 while recognizing
 *   text       : extracted plain text (string)
 *   error      : human-readable error message or null
 *   supported  : always true (Tesseract.js is pure JS)
 *   recognize(file) : kicks off OCR for a File/Blob
 *   reset()    : clears text + error + returns to idle
 */
export function useOCR() {
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [text, setText] = useState('');
  const [error, setError] = useState(null);
  const workerRef = useRef(null);
  const cancelledRef = useRef(false);

  // Lazily create a Tesseract worker on first use and reuse it.
  const ensureWorker = useCallback(async () => {
    if (workerRef.current) return workerRef.current;
    // createWorker returns a worker pre-loaded with eng language data.
    // We keep it simple — eng handles Bangla/Latin characters reasonably
    // for prescription sketches, and the next iteration can swap in `ben`.
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (cancelledRef.current) return;
        if (m.status === 'recognizing text') {
          setProgress(typeof m.progress === 'number' ? m.progress : 0);
        }
      },
    });
    workerRef.current = worker;
    return worker;
  }, []);

  const recognize = useCallback(
    async (file) => {
      if (!file) {
        setError('No file provided.');
        setStatus('error');
        return;
      }
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setError(
          `Unsupported file type: ${file.type || 'unknown'}. Please upload JPG, JPEG, or PNG.`
        );
        setStatus('error');
        return;
      }
      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setError(
          `File is too large (${(file.size / 1024 / 1024).toFixed(
            1
          )} MB). Maximum is ${MAX_FILE_SIZE_MB} MB.`
        );
        setStatus('error');
        return;
      }

      cancelledRef.current = false;
      setError(null);
      setText('');
      setProgress(0);
      setStatus('loading');

      try {
        const worker = await ensureWorker();
        if (cancelledRef.current) return;
        setStatus('recognizing');
        const { data } = await worker.recognize(file);
        if (cancelledRef.current) return;
        setText((data.text || '').trim());
        setStatus('done');
        setProgress(1);
      } catch (err) {
        if (cancelledRef.current) return;
        console.error('[useOCR] recognize failed:', err);
        setError(
          err?.message ||
            'OCR failed. The image may be blurry, too small, or unsupported.'
        );
        setStatus('error');
      }
    },
    [ensureWorker]
  );

  const reset = useCallback(() => {
    cancelledRef.current = true;
    setStatus('idle');
    setProgress(0);
    setText('');
    setError(null);
  }, []);

  // Tear down the worker on unmount to free memory.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (workerRef.current) {
        workerRef.current
          .terminate()
          .catch(() => {
            /* swallow — worker already gone */
          });
        workerRef.current = null;
      }
    };
  }, []);

  return { status, progress, text, error, supported: true, recognize, reset };
}
