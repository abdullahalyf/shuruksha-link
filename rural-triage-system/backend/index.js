// Shuruksha Link — Backend API
// Express server. Health route + Gemini-powered /api/triage (POST).

require('dotenv').config();

const express = require('express');
const cors = require('cors');

const triageRouter = require('./routes/triage');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check route
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Shuruksha Link API',
    message: 'Backend is running. POST /api/triage to request a Gemini verdict.',
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
  console.log(`✅ Shuruksha Link API running on http://localhost:${PORT}`);
});
