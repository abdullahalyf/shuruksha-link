// Shuruksha Link — Backend API
// Minimal Express server: Phase 2 foundation. Gemini endpoints added later.

require('dotenv').config();

const express = require('express');
const cors = require('cors');

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
    message: 'Backend is running. Triage endpoint coming in next step.'
  });
});

// Placeholder for the Gemini triage route (wired in a later step)
app.get('/api/triage', (req, res) => {
  res.json({ message: 'Triage endpoint placeholder. Not yet implemented.' });
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Shuruksha Link API running on http://localhost:${PORT}`);
});
