import { useRef, useState } from 'react';
import {
  useOCR,
  ACCEPTED_EXTENSIONS,
  ACCEPTED_TYPES,
} from '../hooks/useOCR.js';

// Reusable status pill, mirrors VoiceCapture's visual language.
function StatusPill({ status, progress }) {
  const map = {
    idle: {
      label: 'Ready',
      cls: 'bg-slate-100 text-slate-600 ring-slate-200',
      dot: 'bg-slate-400',
    },
    loading: {
      label: 'Loading engine…',
      cls: 'bg-sky-100 text-sky-700 ring-sky-200',
      dot: 'bg-sky-500 animate-pulse',
    },
    recognizing: {
      label: `Reading image · ${Math.round((progress || 0) * 100)}%`,
      cls: 'bg-cyan-100 text-cyan-700 ring-cyan-200',
      dot: 'bg-cyan-500 animate-pulse',
    },
    done: {
      label: 'Text extracted',
      cls: 'bg-emerald-100 text-emerald-700 ring-emerald-200',
      dot: 'bg-emerald-500',
    },
    error: {
      label: 'OCR failed',
      cls: 'bg-rose-100 text-rose-700 ring-rose-200',
      dot: 'bg-rose-500',
    },
  };
  const s = map[status] || map.idle;
  return (
    <span
      className={
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ' +
        s.cls
      }
    >
      <span className={'h-1.5 w-1.5 rounded-full ' + s.dot} aria-hidden="true" />
      {s.label}
    </span>
  );
}

export default function DocumentScan() {
  const { status, progress, text, error, recognize, reset } = useOCR();
  const inputRef = useRef(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [fileName, setFileName] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const isBusy = status === 'loading' || status === 'recognizing';

  const handleFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    // Revoke previous object URL to avoid memory leaks.
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    recognize(file);
  };

  const handleInputChange = (e) => {
    const file = e.target.files?.[0];
    handleFile(file);
  };

  const handleClear = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setFileName('');
    if (inputRef.current) inputRef.current.value = '';
    reset();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <section
      aria-labelledby="document-scan-heading"
      className="
        mt-6 pt-6 border-t border-slate-200/80
      "
    >
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3
          id="document-scan-heading"
          className="text-sm font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-2"
        >
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
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <circle cx="12" cy="14" r="2" />
            <path d="M12 17v3" />
          </svg>
          Document Scan
          <span className="ml-1 text-xs font-medium text-slate-500 normal-case tracking-normal">
            OCR · ডকুমেন্ট স্ক্যান
          </span>
        </h3>
        <StatusPill status={status} progress={progress} />
      </div>

      {/* Drop zone + upload button */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={
          'rounded-2xl border-2 border-dashed p-5 sm:p-6 transition-colors ' +
          (dragOver
            ? 'border-sky-400 bg-sky-50/70'
            : 'border-slate-300 bg-slate-50/60 hover:border-sky-300 hover:bg-sky-50/40')
        }
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          {/* Thumbnail / placeholder */}
          <div
            className="
              h-20 w-20 sm:h-24 sm:w-24 shrink-0
              rounded-xl overflow-hidden
              bg-white border border-slate-200
              grid place-items-center
              shadow-sm
            "
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Selected document preview"
                className="h-full w-full object-cover"
              />
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-8 w-8 text-slate-400"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            )}
          </div>

          <div className="flex-1 min-w-0 w-full">
            <p className="text-sm font-semibold text-slate-800">
              {fileName || 'Upload a prescription or lab report'}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              JPG, JPEG, or PNG · max 10 MB · or drop the file anywhere in this box
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={isBusy}
                className="
                  inline-flex items-center gap-2
                  h-10 px-4 rounded-xl
                  text-sm font-semibold text-white
                  bg-gradient-to-r from-sky-600 to-cyan-600
                  hover:from-sky-700 hover:to-cyan-700
                  disabled:from-slate-300 disabled:to-slate-400 disabled:cursor-not-allowed
                  shadow-md shadow-sky-500/20 hover:shadow-lg hover:shadow-sky-500/30
                  transition-all duration-150
                  focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2
                "
              >
                {isBusy ? (
                  <>
                    <span
                      className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin"
                      aria-hidden="true"
                    />
                    Processing…
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
                      className="h-4 w-4"
                      aria-hidden="true"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    Choose image
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleClear}
                disabled={isBusy && !text && !error}
                className="
                  inline-flex items-center gap-2
                  h-10 px-4 rounded-xl
                  text-sm font-semibold
                  text-slate-700 bg-white
                  border border-slate-300
                  hover:bg-slate-50 hover:border-slate-400
                  disabled:opacity-50 disabled:cursor-not-allowed
                  shadow-sm
                  transition-all duration-150
                  focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2
                "
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
                  aria-hidden="true"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                  <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                </svg>
                Clear document
              </button>

              <input
                ref={inputRef}
                type="file"
                accept={ACCEPTED_EXTENSIONS}
                onChange={handleInputChange}
                className="sr-only"
                aria-label="Upload document image"
              />
            </div>
          </div>
        </div>

        {/* Progress bar (visible only while working) */}
        {(status === 'loading' || status === 'recognizing') && (
          <div className="mt-4">
            <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-sky-500 to-cyan-500 transition-all duration-200"
                style={{
                  width: `${
                    status === 'loading' ? 12 : Math.round((progress || 0) * 100)
                  }%`,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Error banner */}
      {status === 'error' && error && (
        <div
          role="alert"
          className="
            mt-4 flex items-start gap-3
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
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </span>
          <span className="pt-0.5">{error}</span>
        </div>
      )}

      {/* Extracted text panel */}
      <div className="mt-4">
        <label
          htmlFor="ocr-output"
          className="block text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1.5"
        >
          Extracted text
          <span className="ml-1.5 normal-case font-normal text-slate-500">
            {text ? `· ${text.length} chars` : '· awaiting input'}
          </span>
        </label>
        <textarea
          id="ocr-output"
          value={text}
          onChange={() => {
            /* read-only — OCR output is informational until Step 11 */
          }}
          readOnly
          placeholder="OCR text will appear here after you upload an image."
          className="
            w-full h-32 sm:h-36
            px-4 py-3
            text-sm text-slate-800
            font-mono leading-relaxed
            bg-slate-50 border border-slate-300 rounded-xl
            placeholder:text-slate-400
            shadow-sm shadow-slate-900/[0.02]
            focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500
            resize-y
            overflow-y-auto
          "
        />
      </div>
    </section>
  );
}
