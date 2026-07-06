# ER One-Page Summary — SMART on FHIR

A single-page situational-awareness screen for ER physicians at first patient contact. Clean, calm UI with light and dark themes. It pulls together, at a glance:

- **A prose "at a glance" narrative** — generated entirely from the FHIR data: who the patient is, why they're here, triage physiology, notable labs with deltas, safety concerns, and recent care trajectory.
- **Safety-critical flags** — a compact strip of hover-for-detail chips: anticoagulation (with recent-bleed cross-referencing), severe allergies, hyperkalemia, lactate, acute hemoglobin drops, AKI vs. baseline creatinine, QTc + QT-prolonging med combinations, implanted devices, beta-blockade masking shock, contrast allergy/AKI imaging conflicts.
- **The current ED encounter** — triage vitals with trending, computed bedside scores (qSOFA, SIRS, NEWS2, shock index, anion gap — all derived from FHIR vitals/labs), ECG interpretation, labs resulted since arrival with deltas vs. the most recent prior value, and imaging results/orders.
- **Background** — active problems, allergies, implanted devices, and medications with provider-selectable sorting (priority, alphabetical, or by drug class).
- **Recent care & outside records** — ED visits, hospitalizations, clinic visits, and scanned outside documents in a slide-out side tray.
- **Scanned outside media** — DocumentReference attachments are OCR'd in the browser (Tesseract.js) and the extracted diagnoses, medications, labs, and vitals are merged into the main view as discrete data, tagged `OUTSIDE` but otherwise integrated (e.g., an outside discharge hemoglobin becomes the comparison baseline for today's CBC). Every `OUTSIDE` tag is clickable and opens the scanned source document.

**This version is demo-only.** It ships with one richly simulated patient, **John Dorian**, a 72-year-old with AFib on apixaban, HFrEF (EF 30%, ICD), CKD 3b, T2DM, and COPD, presenting in probable urosepsis with AKI, AFib with RVR, and a hemoglobin drop — two months after a duodenal-ulcer GI bleed documented **only** in scanned outside records from Sacred Heart Hospital, so the OCR pathway is load-bearing in the demo.

## Running the demo

No build step. Serve the folder statically and open it:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000/?demo
```

Opening `index.html` without a SMART launch context automatically falls back to demo mode. The two "scanned" outside documents are generated as skewed, noisy page images at runtime and genuinely OCR'd with Tesseract.js — the same pipeline that would process `Binary` attachments from Epic. If the Tesseract CDN is unreachable, the app falls back to the embedded document text and labels the extraction as simulated.

## Connecting to the Epic sandbox (after the demo period)

Everything displayed is sourced from FHIR R4 resources Epic exposes: `Patient`, `Encounter`, `Condition`, `MedicationRequest`, `AllergyIntolerance`, `Observation` (vital-signs + laboratory), `DiagnosticReport`, `DocumentReference`/`Binary`, and `Device`. Computed items (scores, deltas, risk flags) are derived client-side from that data only.

1. Register the app at [fhir.epic.com](https://fhir.epic.com) (Patient- or Clinician-facing app, R4). Set the **launch URL** to `launch.html` and the **redirect URL** to `index.html` at wherever this repo is hosted (GitHub Pages works: `https://marchgoblue.github.io/ER-summary/`).
2. Enable the read scopes listed in [launch.html](launch.html).
3. Paste the issued **Non-Production Client ID** into `launch.html` (`REPLACE_WITH_EPIC_CLIENT_ID`).
4. Launch against the Epic sandbox (e.g., from the fhir.epic.com launchpad or with test patients like Camila Lopez). The app uses the identical extraction/render pipeline as demo mode.

Notes for sandbox testing: Epic's sandbox test patients have sparse data, so several panels will show "none on file"; the demo bundle in [js/demo-data.js](js/demo-data.js) documents the exact resource shapes the app consumes if you want to load richer test data into a sandbox via `$import`-style tooling. Terminology codes in the demo bundle (LOINC/SNOMED/RxNorm) are illustrative demo-grade codes.

## Repo layout

| File | Purpose |
|---|---|
| [index.html](index.html) | App shell; SMART redirect target; demo fallback |
| [launch.html](launch.html) | SMART on FHIR EHR launch endpoint (scopes + client ID) |
| [js/fhir-data.js](js/fhir-data.js) | Live FHIR queries + normalization into the view model |
| [js/risk-engine.js](js/risk-engine.js) | Critical-flag detection and bedside score computation |
| [js/summary.js](js/summary.js) | Generates the prose "at a glance" narrative from the view model |
| [js/ocr.js](js/ocr.js) | Tesseract OCR of scanned media + discrete-data parsing |
| [js/app.js](js/app.js) | Mode bootstrap and all rendering |
| [js/demo-data.js](js/demo-data.js) | John Dorian FHIR R4 bundle (dates anchored to "today") |
| [js/demo-outside-docs.js](js/demo-outside-docs.js) | Generates the simulated scanned outside documents |

## Disclaimers

John Dorian is fictitious; any resemblance to Sacred Heart Hospital staff is affectionate. **Not a medical device; not for clinical use.** Demo/educational purposes only.
