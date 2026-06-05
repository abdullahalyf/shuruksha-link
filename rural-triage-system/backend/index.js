// Shuruksha Link - Backend API
// Express server. Health routes + Gemini-powered /api/triage (POST).

require('dotenv').config();

const express = require('express');
const cors = require('cors');

const triageRouter = require('./routes/triage');

const app = express();
const PORT = process.env.PORT || 5000;
const ENV = process.env.NODE_ENV || 'development';
const BOOT_TIME = Date.now();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// --- Health endpoints ----------------------------------------------------
// Three flavors so Render, Vercel cron pings, and curl-style ops checks
// all see the same machine-readable contract.
//
//   GET /             -> liveness + service info (used by the frontend
//                        status pill on boot).
//   GET /healthz      -> lightweight liveness (no body inspection).
//   GET /api/healthz  -> same as /healthz, mounted under /api for
//                        frontends / uptime monitors that prefer a
//                        namespaced health path. Exposes a coarse
//                        gemini_key_configured flag (no key value).
function geminiKeyConfigured() {
  const key = process.env.GEMINI_API_KEY;
  return Boolean(
    key &&
      typeof key === 'string' &&
      key.trim().length > 0 &&
      key !== 'your_gemini_api_key_here'
  );
}

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Shuruksha Link API',
    environment: ENV,
    uptime_seconds: Math.round((Date.now() - BOOT_TIME) / 1000),
    message:
      'Backend is running. POST /api/triage to request a Gemini verdict.',
  });
});

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/healthz', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Shuruksha Link API',
    environment: ENV,
    uptime_seconds: Math.round((Date.now() - BOOT_TIME) / 1000),
    gemini_key_configured: geminiKeyConfigured(),
    timestamp: new Date().toISOString(),
  });
});

// Triage route
app.use('/api/triage', triageRouter);

// 404 fallback
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Centralized error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(
    '[server] Shuruksha Link API running on http://localhost:' + PORT +
      ' (env=' + ENV + ', gemini_key=' +
      (geminiKeyConfigured() ? 'configured' : 'MISSING') + ')'
  );
});
