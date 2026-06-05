# Shuruksha Link - Deployment Guide

This document covers everything needed to take the Shuruksha Link rural
triage workstation from `localhost` to a public deployment.

The app is a two-service system:

| Service  | Stack          | Hosting target | URL (example)                              |
| -------- | -------------- | -------------- | ------------------------------------------ |
| Frontend | Vite + React   | Vercel         | `https://shuruksha-link.vercel.app`        |
| Backend  | Express + Node | Render         | `https://shuruksha-link-api.onrender.com`  |

The browser talks to the backend only at boot (smoke test) and on
`POST /api/triage`. LocalStorage holds the audit trail, so the backend
remains stateless and can be redeployed freely.

---

## 1. Architecture

```
+--------------------------+        HTTPS         +----------------------------+
|  Browser (Vercel)        |  POST /api/triage    |  Render (Node 20)          |
|  React + Vite SPA        | -------------------> |  Express                   |
|  - Tesseract.js (OCR)    |                      |  - /api/triage  (Gemini)   |
|  - Web Speech API        |  GET  /api/healthz   |  - /api/healthz (ops)      |
|  - jsPDF (exports)       | <------------------- |  - /healthz     (liveness) |
|  - LocalStorage history  |                      |  - CORS + JSON parser      |
+--------------------------+                      +----------------------------+
                                                          |
                                                          v
                                              Google Gemini 2.5 Flash
                                              (model fallback chain)
```

- The frontend builds to a static `dist/` and is hosted as a Vite SPA
  with a catch-all rewrite to `index.html`.
- The backend runs as a long-lived Node web service on Render. It uses
  Render's auto-injected `PORT` and reads `GEMINI_API_KEY` from env.
- No database, no sessions, no cookies - all persistent state lives in
  the browser. That keeps the surface area minimal and the cost $0.

---

## 2. Environment variables

### Backend (`backend/.env`, or Render dashboard)

| Name             | Required | Example                                | Notes                                                  |
| ---------------- | -------- | -------------------------------------- | ------------------------------------------------------ |
| `GEMINI_API_KEY` | YES      | `AIza...`                              | Get one at https://aistudio.google.com/apikey (free).  |
| `PORT`           | no       | `5000`                                 | Render injects this automatically in production.       |
| `NODE_ENV`       | no       | `production`                           | Toggles the "env=" log line and any future env checks. |

The repo ships a `backend/.env.example` that documents the same list.

### Frontend (`frontend/.env.development`, `.env.production`, or Vercel)

| Name                  | Required in dev | Required in prod | Example                                       | Notes                                                                                       |
| --------------------- | --------------- | ---------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`   | no (empty)      | YES              | `https://shuruksha-link-api.onrender.com`     | Absolute origin of the backend, no trailing slash. In dev leave empty to use the Vite proxy. |
| `VITE_APP_ENV`        | no              | no               | `production`                                  | Free-form label surfaced in the UI / build logs.                                            |

The repo ships a `frontend/.env.example` and pre-baked
`frontend/.env.development` (empty URL) and
`frontend/.env.production` (placeholder Render URL).

> **Security:** real `.env*` files are matched by the root `.gitignore`
> and are never committed. Only `.env.example` and the safe
> `.env.development`/`.env.production` defaults are checked in.

---

## 3. Local development

### One-time setup

```bash
# Backend
cd backend
npm install
cp .env.example .env          # then paste your real GEMINI_API_KEY

# Frontend
cd ../frontend
npm install
```

`frontend/.env.development` is already in place with
`VITE_API_BASE_URL=` (empty), so the Vite dev-server proxy forwards
`/api/*` and `/healthz` to `http://localhost:5000`.

### Run both services

```bash
# Terminal 1
cd backend
npm run dev          # nodemon on :5000

# Terminal 2
cd frontend
npm run dev          # Vite on :5173
```

Open http://localhost:5173 - the status pill in the header should read
"API Online".

### Verifying locally

```bash
# Backend health
curl http://localhost:5000/api/healthz
# -> { "status": "ok", "service": "Shuruksha Link API", "environment": "development",
#      "uptime_seconds": 12, "gemini_key_configured": true, "timestamp": "..." }

# Lightweight liveness (Render / cron pings)
curl http://localhost:5000/healthz
# -> { "status": "ok" }
```

OCR and voice run entirely in the browser, so no extra configuration is
needed.

### Voice-capture fallback

The Web Speech API only works in Chromium-based browsers
(Chrome, Edge, Brave, Arc, Kiwi) and Safari. When the API is absent or
denied permission, `VoiceCapture.jsx` already shows a clear "voice
capture not supported in this browser" hint and the rest of the
workstation (vitals, OCR, Gemini) keeps working - the user simply
types the symptoms manually.

---

## 4. Vercel setup (frontend)

1. Push the repo to GitHub.
2. In Vercel, click **Add New -> Project** and import the repo.
3. Set the **Root Directory** to `frontend`.
4. Vercel auto-detects the Vite framework. Confirm:
   - Build command: `npm run build`
   - Output directory: `dist`
   - Install command: `npm install`
5. Open **Environment Variables** and add:
   - `VITE_API_BASE_URL` = `https://<your-render-app>.onrender.com`
     (no trailing slash)
   - `VITE_APP_ENV`     = `production`
6. Click **Deploy**. Vercel will:
   - run `npm install`
   - run `npm run build`
   - serve `dist/` with the SPA rewrite from `frontend/vercel.json`
7. Open the deployment URL, confirm the status pill says
   "API Online", and run one triage request.

> The `vercel.json` checked into `frontend/` is the source of truth
> for the build commands, output dir, and SPA rewrite. You do not
> need to configure any of that by hand in the Vercel UI.

### Custom domain (optional)

Vercel -> Project -> Settings -> Domains. Add the domain you own,
update the DNS records Vercel shows you, and the new hostname
automatically receives the SPA + `/api/*` rewrite.

---

## 5. Render setup (backend)

1. In Render, click **New -> Blueprint**.
2. Connect the GitHub repo. Render reads `render.yaml` from the repo
   root and proposes one web service: `shuruksha-link-api`.
3. Render will ask for the `GEMINI_API_KEY` secret - paste your real
   Google AI Studio key. It's stored encrypted and masked in the UI.
4. Confirm the plan (the free Starter plan works for the hackathon).
5. Click **Apply**. Render runs `npm install` then `npm start`.
   The health check path is `/healthz`.
6. When the service is live, copy the public URL
   (e.g. `https://shuruksha-link-api.onrender.com`).
7. Go back to Vercel and set `VITE_API_BASE_URL` to that URL,
   then redeploy the frontend.
8. Smoke-test from a terminal:
   ```bash
   curl https://<your-render-app>.onrender.com/api/healthz
   # -> { "status": "ok", "gemini_key_configured": true, ... }
   ```

### CORS

The backend uses `cors()` with default open CORS so the Vercel origin
can call it from the browser without extra configuration. If you
later need to lock it down, swap `app.use(cors())` for an explicit
allow-list keyed on the Vercel hostname.

### Cold starts

The Render free plan spins down after 15 minutes of inactivity. The
first triage request after a long pause will take ~30 s while the
service wakes up; subsequent requests are fast. The frontend's
existing retry/backoff inside `routes/triage.js` (3 attempts with
1 s / 2 s / 4 s backoff per model in the chain) covers the wake-up
case automatically.

---

## 6. Build & run commands reference

| Task                              | Where    | Command                |
| --------------------------------- | -------- | ---------------------- |
| Install backend deps              | `backend/` | `npm install`        |
| Run backend (dev, hot reload)     | `backend/` | `npm run dev`        |
| Run backend (prod)                | `backend/` | `npm start`          |
| Install frontend deps             | `frontend/` | `npm install`       |
| Run frontend dev server           | `frontend/` | `npm run dev`       |
| Build frontend for production     | `frontend/` | `npm run build`     |
| Preview the production build      | `frontend/` | `npm run preview`   |
| Render build command              | Render   | `npm install` (in `backend/`) |
| Render start command              | Render   | `npm start`           |
| Vercel build command              | Vercel   | `npm run build` (in `frontend/`) |

---

## 7. Troubleshooting

### Frontend: status pill says "API Offline"

- **Dev**: make sure the backend is running (`cd backend && npm run dev`).
  The Vite proxy needs the backend on `http://localhost:5000`.
- **Prod**: check that `VITE_API_BASE_URL` is set in the Vercel project
  (Settings -> Environment Variables) and that the value matches the
  Render URL exactly, no trailing slash, including the `https://`.
- **CORS**: the backend uses open CORS by default. If you locked it
  down, allow the Vercel hostname.

### Backend: `GEMINI_API_KEY is not configured`

- `.env` is missing or the key still equals the placeholder
  `your_gemini_api_key_here`. On Render, set the `GEMINI_API_KEY`
  secret and **redeploy** (env changes don't auto-restart).

### Backend: `The AI service has reached its request quota`

- Free-tier Gemini caps at 15 req/min. Either wait a minute or wire a
  billing-enabled key in Google AI Studio.

### Backend: cold start feels slow on Render free plan

- Expected. The first request after ~15 min idle takes ~30 s while
  Render spins the service back up. The internal retry chain covers
  it; the user just sees a longer "Analyzing..." spinner.

### Frontend: voice button says "not supported"

- The Web Speech API only exists in Chromium browsers and Safari.
  Switch to Chrome/Edge or type the symptoms manually - OCR,
  vitals, and Gemini keep working.

### Frontend: OCR says "OCR not supported in this browser"

- Tesseract.js itself works everywhere, but the easiest path is to
  upload a clear photo of the document. If the user is on an old
  browser, fall back to typing the report text manually.

### Frontend: SPA routes 404 on Vercel direct hits

- Confirmed by the `vercel.json` rewrite rule
  `{ "source": "/(.*)", "destination": "/index.html" }`.
  If you ever delete that block, every deep link will 404.

### Render: "service unhealthy"

- The health check path is `/healthz` (configured in `render.yaml`).
  Curl it manually; if it returns `{"status":"ok"}` but Render still
  marks the service unhealthy, check the build/start logs for
  port binding - the service must `app.listen(process.env.PORT)`.

### Vercel: build fails with "vite: not found"

- The `Root Directory` is wrong (must be `frontend/`) or
  `npm install` did not run. In the Vercel project settings, confirm
  Root Directory = `frontend` and rebuild.

---

## 8. Post-deploy checklist

- [ ] `curl https://<render-app>.onrender.com/api/healthz` returns
      `gemini_key_configured: true`.
- [ ] Open the Vercel URL in a browser, confirm the status pill says
      "API Online".
- [ ] Run a triage request end-to-end. Verify the PDF export works.
- [ ] Open DevTools -> Application -> LocalStorage; confirm the
      `shuruksha_link_case_history_v1` key is being written to.
- [ ] Reload the page; confirm the audit trail persists.
- [ ] Optional: point a custom domain at the Vercel project.
