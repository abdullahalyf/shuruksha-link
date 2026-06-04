# Product Requirements Document (PRD): Shuruksha Link

## 1. Problem Statement

### The Reality in the Field

* Rural Bangladesh possesses over 80,000 community clinics and localized healthcare posts.
* These frontline health outposts face severe, structural understaffing challenges on a daily basis.

### Clinical Bottleneck

* Community Health Workers (CHWs) operate without advanced diagnostic tools or formal, deep physician training.
* Patients frequently undertake long, expensive journeys to urban centers only to find a specialist is unavailable, or they suffer complications due to avoidable misdiagnoses.

### The Data Black Hole

* Massive volumes of historical patient clinical data remain trapped entirely on paper.
* Handwritten prescriptions, physical lab diagnostics, and field clinical notes are never digitized, tracked, or evaluated for risk patterns.

---

## 2. Target Users

### Primary Users

*  frontline Community Health Workers (CHWs): Localized healthcare workers operating inside rural village environments and basic triage clinics.

### Characteristics

* **Dual-Language Interface Needs:** Requires application support in both Bengali and English for seamless data entry and comprehension.
* **Smartphone Users:** Comfortable using basic smartphone messaging interfaces and mobile web browsers, requiring simplified software mechanics.

---

## 3. MVP Features (Hackathon Scope)

### Feature 1: Dual-Language Voice Intake Module

* Captures real-time patient symptom audio streams directly inside the web browser.
* Natively supports both Bengali and English spoken inputs.
* Automatically normalizes spoken text into clear, standardized English strings within the user interface input field.

### Feature 2: Single-Upload Vision Matrix (OCR & NER)

* Allows the health worker to capture a smartphone photo of old handwritten paper prescriptions or physical lab reports.
* Extracts raw text strings from uploaded images automatically.
* Automatically categorizes medical entities including medication names, specific dosages, and past diagnostic evaluations.

### Feature 3: Rule-Based Vitals Anomaly Detector

* Structured form input fields to record:
* Blood Pressure (BP)
* Heart Rate
* Body Temperature
* Oxygen Saturation (SpO2)
* Blood Glucose levels


* Uses fast, client-side math routines to flag values outside safe operating limits instantly.
* Appends active warnings directly to the final triage calculation matrix.

### Feature 4: LLM Clinical Reasoning Engine

* Processes consolidated inputs through a secure backend API routing wrapper.
* Generates an explicit visual safety designation:
* **RED:** Urgent Emergency / High Risk
* **YELLOW:** Observation Needed / Moderate Risk
* **GREEN:** Stable Case / Low Risk
* **BLACK:** Critical / Unresponsive


* Outputs clear differential diagnoses, immediate localized first-aid action items, and structured physician referral timelines.

### Feature 5: Local Speech Summary & Report Generator

* Uses the web browser's built-in audio synthesis engine to read out triage assessments aloud in the health worker's preferred language.
* Generates a structured digital PDF summary containing all intake fields, vitals logs, and AI insights.
* Supports saving files locally or forwarding them directly to supervising medical doctors.

---

## 4. Nice-to-Have Features (Post-Hackathon Roadmap)

* **Full Offline Operation Mode:** Local browser storage synchronization mechanisms to save records in areas with poor or intermittent network connectivity.
* **Automated Emergency Alerts:** Automated text alerts via SMS or WhatsApp integration channels sent to regional hospital networks when a "RED" emergency alert is triggered.
* **Historical Patient Log Analytics:** Aggregated visual charts to help tracking local disease trends and patient history over time.

---

## 5. User Flow

```
[CHW logs in to Web App] 
       │
       ▼
[Step 1: Enter Numbers] ───► Type Vitals (BP, Pulse, SpO2) -> Dynamic safety check flags alerts
       │
       ▼
[Step 2: Voice Capture] ───► Tap Mic Icon -> Speak Symptoms (Bengali/English) -> Live text appears
       │
       ▼
[Step 3: Document Scan] ───► Upload smartphone picture of past paper prescription notes
       │
       ▼
[Step 4: AI Analysis]   ───► Click "Process Triage Request" -> Core API evaluates datasets
       │
       ▼
[Step 5: View Results]  ───► UI flashes Triage Color Code (Red/Yellow/Green) + First-Aid Steps
       │
       ▼
[Step 6: Clear Actions] ───► Click "Play Audio Output" and export standardized Physician PDF

```

---

## 6. Database Design

> **Hackathon Architecture Note:** To eliminate configuration errors and maximize execution speed, the application bypasses persistent external databases. It utilizes an in-memory runtime array on the backend server paired with browser-native `localStorage` to retain case histories across page refreshes.

### Triage Record Schema Structure

| Field Key Name | Structural Type | Technical Application Context |
| --- | --- | --- |
| `id` | String | Unique timestamp-based tracking identification. |
| `timestamp` | String | Automated record creation date/time string. |
| `vitals` | Object | Nested properties: `bp` (string), `heartRate` (number), `temperature` (number), `oxygen` (number), `glucose` (number). |
| `vitalsAlerts` | Array | Generated collection of string notifications for values outside normal ranges. |
| `symptomsTxt` | String | Raw translated input text derived from vocal recordings. |
| `aiTriageOutput` | Object | Keys include: `triageScore` (RED/YELLOW/GREEN/BLACK), `reasoning` (text), `differential` (array), `firstAid` (array), `urgency` (text). |

---

## 7. Screen List

### 1. The Comprehensive Triage Workstation Dashboard

* A unified, single-page layout engineered for rapid data entry and presentation efficiency.
* **Left-Panel Controls:** Input forms for vital metrics, voice recording toggles, and document file upload dropzones.
* **Right-Panel Display:** Active diagnostic outputs, color-coded triage badges, structured text insights, and report download controls.

### 2. Historical Case Register View

* A simple, responsive secondary layout displaying a clean data table.
* Allows health workers to browse, sort, and re-examine past patient triage cases processed during the active session.

---

## 8. UI/UX Recommendations

* **Mobile-First Responsive Framework:** Built using flexible Tailwind CSS stacking classes (`grid-cols-1 lg:grid-cols-2`) to ensure flawless operational layouts across small mobile phone screens and tablets.
* **High-Contrast Interface Elements:** Utilizes bold, highly visible typography states alongside deep dark text backdrops (`text-slate-900`) to maintain readability in bright outdoor sunlight or dim rural facility spaces.
* **Explicit Triage Alert Highlights:** Uses high-impact background colors to eliminate medical confusion:
* **RED Emergency State:** `bg-rose-600 text-white`
* **YELLOW Observation State:** `bg-amber-500 text-slate-900`
* **GREEN Stable State:** `bg-emerald-600 text-white`


* **Generous Touch Targets:** Maintains minimal interactive dimensions across all interactive buttons, inputs, and toggles (`h-12` / 48px) to enable easy tapping on mobile viewports.

---

## 9. Tech Stack Recommendation

* **Frontend Framework:** React.js initialized via Vite for fast local asset building and instant hot-reloading.
* **Utility Styling Engine:** Tailwind CSS framework for building high-fidelity visual UI designs straight inside HTML class strings.
* **Backend Runtime Environment:** Node.js framework paired with an Express.js routing engine to serve as a secure API processing pipeline.
* **Document Compilation Engine:** Client-side `jspdf` package toolset for building and exporting structured PDF reports on the fly.

---

## 10. APIs Needed

| Target System Action | Selected API Technology Wrapper | Implementation Strategy & Cost Breakdown |
| --- | --- | --- |
| **Multilingual Audio Capture** | **Web Speech Recognition API** | Native Web Browser Component. Cost: **$0**. Zero cloud setup steps required. Natively handles English and Bengali voice inputs. |
| **OCR, Document Parsing & Triage Reasoning** | **Google Gemini 1.5 Flash API** | Multi-Modal LLM Pipeline. Cost: **$0** (Free tier covers up to 15 requests per minute). Reads text directly from document photos, extracts data, and returns formatted JSON. |
| **Local Text-to-Speech** | **Web SpeechSynthesis API** | Native Web Browser Audio Component. Cost: **$0**. Provides instant audio playback without network latency or external service tokens. |

---

## 11. Folder Structure

```
rural-triage-system/
├── backend/
│   ├── uploads/            # Temporary storage for uploaded medical images
│   ├── .env                # Private environmental variables (GEMINI_API_KEY)
│   ├── index.js            # Main Express application server routing engine
│   └── package.json        # Backend software dependency tracking manifests
└── frontend/
    ├── src/
    │   ├── assets/         # Dashboard icons and static graphic resources
    │   ├── App.jsx         # Core layout component and system state matrix
    │   ├── index.css       # Tailwind configuration directive setups
    │   └── main.jsx        # App component mount points
    ├── index.html          # Base web template frame
    ├── tailwind.config.js  # Styling breakpoint target path arrays
    └── package.json        # Frontend package configuration logs

```

---

## 12. Development Roadmap

### Phase 1: Foundation Setup

* Create project root workspaces and clear subfolder structures.
* Execute package installations for both frontend and backend dependency trees.
* Verify clean initialization environments by booting up development servers.

### Phase 2: Secure Backend Gateway Setup

* Construct the core Express.js application environment using standard middleware engines (`cors`, `express.json`).
* Set up `multer` storage destinations to handle image data routing streams securely.
* Build the system prompt strings and bind the application endpoint handlers directly to the Google Gemini API.

### Phase 3: Frontend Layout Construction

* Build the responsive split-panel user workspace using Tailwind CSS classes.
* Implement input data forms alongside interactive client-side threshold validation rules for patient vitals.
* Connect custom state variables to drive immediate warning notification styles.

### Phase 4: Device Hardware Connections

* Bind the browser's native `webkitSpeechRecognition` triggers to handle direct microphone audio streams.
* Construct the automated document generation workflows inside the client UI using the `jspdf` library configuration controls.
* Hook up the local browser audio speakers to drive the text-to-speech feedback system.

### Phase 5: Refinement, Verification & Launch

* Conduct system end-to-end tests using mock patient symptoms and target vitals configurations.
* Push codebase files to remote source control and execute production deployments across Vercel and Render platforms.
* Cross-check operational deliverables against official hackathon evaluation guidelines.