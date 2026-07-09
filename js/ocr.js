/**
 * ocr.js
 * OCR pipeline for scanned outside media (DocumentReference attachments).
 *
 * Pipeline: attachment image (base64 data or Binary URL) → Tesseract.js →
 * raw text → parseOutsideDocument() → discrete findings (diagnoses,
 * medications, labs, vitals) that are merged into the main view alongside
 * native FHIR data, tagged with source: 'outside'.
 *
 * If Tesseract fails (offline/CDN blocked), the document's embedded fallback
 * text is parsed instead and the UI labels extraction as simulated.
 */

(function () {

  let tesseractWorkerPromise = null;

  function getWorker() {
    if (!tesseractWorkerPromise) {
      if (typeof Tesseract === 'undefined') return null;
      tesseractWorkerPromise = Tesseract.createWorker('eng');
    }
    return tesseractWorkerPromise;
  }

  /**
   * OCR one image (data URL). Returns { text, engine, lines } where lines is
   * [{ text, confidence }] — Tesseract's 0–100 confidence estimate per
   * recognized line, used to flag findings that need verification.
   */
  async function ocrImage(dataUrl, onProgress) {
    try {
      const workerP = getWorker();
      if (!workerP) throw new Error('Tesseract not loaded');
      const worker = await workerP;
      const { data } = await worker.recognize(dataUrl, {}, { text: true, blocks: true });
      return { text: data.text || '', engine: 'tesseract', lines: confidenceLines(data) };
    } catch (err) {
      console.warn('OCR failed, will use fallback text if available:', err);
      return { text: '', engine: 'failed', lines: [] };
    }
  }

  /** Flatten a Tesseract result into [{ text, confidence }] per line. */
  function confidenceLines(data) {
    const out = [];
    const push = l => {
      const text = (l.text || '').trim();
      if (text) out.push({ text, confidence: typeof l.confidence === 'number' ? l.confidence : null });
    };
    (data.blocks || []).forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(push)));
    /* Older Tesseract.js builds expose lines at the top level instead. */
    if (!out.length && Array.isArray(data.lines)) data.lines.forEach(push);
    return out;
  }

  /* ----------------------------------------------------- text parsing */

  const LAB_PATTERNS = [
    { re: /h[ae]moglobin(?:\s*nadir)?\s*:?\s*(\d{1,2}\.\d)\s*g\/?dl/i, label: 'Hemoglobin', unit: 'g/dL', loinc: '718-7', nadirRe: /nadir/i },
    { re: /platelets?\s*:?\s*(\d{2,3})\b/i, label: 'Platelets', unit: '10*3/uL', loinc: '777-3' },
    { re: /creatinine\s*:?\s*(\d{1,2}\.\d)\s*mg\/?dl/i, label: 'Creatinine', unit: 'mg/dL', loinc: '2160-0' },
    { re: /\bINR\s*:?\s*(\d\.\d)\b/i, label: 'INR', unit: '', loinc: '6301-6' }
  ];

  const MED_LINE = /^[-•*]?\s*([A-Z][A-Za-z]+(?:\s*\([A-Za-z ]+\))?\s+\d+(?:\.\d+)?\s*(?:mg|mcg|g|units?)\b[^\n]*)$/;

  const VITAL_PATTERNS = [
    { re: /temp\w*\s*:?\s*(\d{2}\.\d)\s*C/i, label: 'Temperature', unit: '°C' },
    { re: /\bHR\s*:?\s*(\d{2,3})\b/i, label: 'Heart rate', unit: '/min' },
    { re: /\bBP\s*:?\s*(\d{2,3}\/\d{2,3})\b/i, label: 'Blood pressure', unit: 'mmHg' },
    { re: /SpO2\s*:?\s*(\d{2,3})\s*%/i, label: 'SpO2', unit: '%' }
  ];

  /**
   * Parse OCR text into discrete findings.
   * Returns array of { kind, text, value, unit, loinc, isNadir, conf }.
   * ocrLines ([{ text, confidence }], optional) supplies Tesseract's per-line
   * confidence; each finding inherits the confidence of the line it came from
   * (conf is null for fallback text that never went through OCR).
   */
  function parseOutsideDocument(text, docLabel, ocrLines) {
    const findings = [];
    const lines = (ocrLines && ocrLines.length)
      ? ocrLines
      : text.split(/\n/).map(l => ({ text: l.trim(), confidence: null })).filter(l => l.text);

    let section = '';
    for (const { text: line, confidence: conf } of lines) {
      /* Track section headers */
      if (/^discharge diagnos/i.test(line)) { section = 'diagnoses'; continue; }
      if (/^assessment\s*:?/i.test(line)) {
        section = 'diagnoses';
        const inline = line.replace(/^assessment\s*:?\s*/i, '');
        if (inline) findings.push({ kind: 'diagnosis', text: inline, conf, docLabel });
        continue;
      }
      if (/^(discharge medications|new prescription)/i.test(line)) { section = 'medications'; continue; }
      if (/^(discharge labs|results|vitals|hospital course|follow.?up|instructions|reason for visit)/i.test(line)) { section = 'other'; }

      /* Numbered or bulleted diagnoses */
      if (section === 'diagnoses') {
        const m = line.match(/^\d+\.\s*(.+)$/) || (line.startsWith('-') ? [null, line.slice(1).trim()] : null);
        if (m) { findings.push({ kind: 'diagnosis', text: m[1], conf, docLabel }); continue; }
      }

      /* Medication lines */
      if (section === 'medications') {
        const m = line.match(MED_LINE);
        if (m) {
          const parts = m[1].split(/\s+(?=\d)/);
          findings.push({ kind: 'medication', text: m[1], drug: parts[0], conf, docLabel });
          continue;
        }
      }

      /* Lab values anywhere in the text */
      for (const p of LAB_PATTERNS) {
        const m = line.match(p.re);
        if (m) {
          findings.push({
            kind: 'lab', label: p.label, value: parseFloat(m[1].replace('/', '')) || m[1],
            rawValue: m[1], unit: p.unit, loinc: p.loinc,
            isNadir: !!(p.nadirRe && p.nadirRe.test(line)),
            text: p.label + ' ' + m[1] + (p.unit ? ' ' + p.unit : ''), conf, docLabel
          });
        }
      }

      /* Vitals */
      for (const p of VITAL_PATTERNS) {
        const m = line.match(p.re);
        if (m) findings.push({ kind: 'vital', label: p.label, rawValue: m[1], unit: p.unit, text: p.label + ' ' + m[1] + ' ' + p.unit, conf, docLabel });
      }

      /* Anticoagulation interruption callouts */
      if (/apixaban|warfarin|anticoagul/i.test(line) && /held|resumed|interrupt|stopp/i.test(line)) {
        findings.push({ kind: 'anticoag-note', text: line, conf, docLabel });
      }
    }

    /* De-duplicate labs (same loinc + value) */
    const seen = new Set();
    return findings.filter(f => {
      const key = f.kind + '|' + (f.loinc || '') + '|' + (f.rawValue || f.text);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Process all outside documents on the view model.
   * Each doc needs doc.imageDataUrl (set by app.js) and optionally
   * doc.fallbackText. Mutates vm: adds outsideFindings, outsideMeds,
   * outsideLabs and per-doc ocr results.
   */
  async function processOutsideDocs(vm, onStatus) {
    vm.outsideFindings = [];
    vm.outsideMeds = [];
    vm.outsideLabs = [];

    for (const doc of vm.outsideDocs) {
      if (!doc.imageDataUrl && !doc.fallbackText && !doc.ocr) continue;
      const docLabel = (doc.custodian || 'Outside facility') + ', ' + window.FhirData.fmtDate(doc.date);

      let findings;
      if (doc.ocr && doc.ocr.findings) {
        /* Already OCR'd (e.g. carried over across a data refresh) — reuse. */
        findings = doc.ocr.findings;
      } else {
        onStatus && onStatus(doc, 'running');
        let text = '', engine = 'none', ocrLines = null;
        if (doc.imageDataUrl) {
          const res = await ocrImage(doc.imageDataUrl);
          text = res.text; engine = res.engine; ocrLines = res.lines;
        }
        if ((!text || text.trim().length < 40) && doc.fallbackText) {
          text = doc.fallbackText;
          engine = engine === 'tesseract' ? 'tesseract-lowconf-fallback' : 'fallback';
          ocrLines = null; /* fallback text never went through OCR — no confidences */
        }

        findings = parseOutsideDocument(text, docLabel, ocrLines);
        findings.forEach(f => { f.docId = doc.id; });
        doc.ocr = { text, engine, findings };
      }

      findings.forEach(f => {
        vm.outsideFindings.push(f);
        if (f.kind === 'medication') {
          vm.outsideMeds.push({ text: f.text, dose: '', source: 'outside', conf: f.conf, docLabel, docId: doc.id, date: doc.date });
        }
        if (f.kind === 'lab' && !f.isNadir) {
          vm.outsideLabs.push({ loinc: f.loinc, label: f.label, value: f.value, unit: f.unit, effective: doc.date, source: 'outside', conf: f.conf, docLabel, docId: doc.id });
        }
      });

      onStatus && onStatus(doc, 'done');
    }

    /* Outside labs become prior values for delta comparison when the EHR has
       nothing more recent. */
    vm.outsideLabs.forEach(l => {
      const existing = vm.priorByLoinc[l.loinc];
      if (!existing || new Date(l.effective) > new Date(existing.effective)) {
        vm.priorByLoinc[l.loinc] = { ...l, interp: '', ref: '' };
      }
    });
  }

  window.Ocr = { processOutsideDocs, parseOutsideDocument };
})();
