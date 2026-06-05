// Shuruksha Link - API base URL helper.
// Reads VITE_API_BASE_URL (set via .env.development / .env.production
// at build time) and exposes two URL builders. Centralised so the
// production swap is a one-line change.

const RAW_BASE = (import.meta.env.VITE_API_BASE_URL || '').trim();
const IS_PROD = import.meta.env.PROD === true;

// Trim a trailing slash so concat targets never end up with "//".
function stripTrailingSlash(s) {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

// In production we expect an absolute base URL (e.g. https://api.shuruksha.app).
// In dev the .env.development file leaves it empty, so the Vite dev-server
// proxy routes /api and /healthz to http://localhost:5000 instead.
export const API_BASE = IS_PROD ? stripTrailingSlash(RAW_BASE) : '';

export function apiUrl(path) {
  const p = path.startsWith('/') ? path : '/' + path;
  if (!API_BASE) return p; // dev: same-origin (Vite proxy)
  return API_BASE + p;
}

export function healthUrl() {
  return apiUrl('/api/healthz');
}

export function triageUrl() {
  return apiUrl('/api/triage');
}

export function translateUrl() {
  return apiUrl('/api/translate');
}

export function rootHealthUrl() {
  return apiUrl('/');
}
