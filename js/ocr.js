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

  /** OCR one image (data URL). Returns { text, engine } */
  async function ocrImage(dataUrl, onProgress) {
    try {
      const workerP = getWorker();
      if (!workerP) throw new Error('Tesseract not loaded');
      const worker = await workerP;
      const { data } = await worker.recognize(dataUrl);
      return { text: data.text || '', engine: 'tesseract' };
    } catch (err) {
      console.warn('OCR failed, will use fallback text if available:', err);
      return { text: '', engine: 'failed' };
    }
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
   * Returns array of { kind, text, value, unit, loinc, isNadir }.
   */
  function parseOutsideDocument(text, docLabel) {
    const findings = [];
    const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);

    let section = '';
    for (const line of lines) {
      /* Track section headers */
      if (/^discharge diagnos/i.test(line)) { section = 'diagnoses'; continue; }
      if (/^assessment\s*:?/i.test(line)) {
        section = 'diagnoses';
        const inline = line.replace(/^assessment\s*:?\s*/i, '');
        if (inline) findings.push({ kind: 'diagnosis', text: inline, docLabel });
        continue;
      }
      if (/^(discharge medications|new prescription)/i.test(line)) { section = 'medications'; continue; }
      if (/^(discharge labs|results|vitals|hospital course|follow.?up|instructions|reason for visit)/i.test(line)) { section = 'other'; }

      /* Numbered or bulleted diagnoses */
      if (section === 'diagnoses') {
        const m = line.match(/^\d+\.\s*(.+)$/) || (line.startsWith('-') ? [null, line.slice(1).trim()] : null);
        if (m) { findings.push({ kind: 'diagnosis', text: m[1], docLabel }); continue; }
      }

      /* Medication lines */
      if (section === 'medications') {
        const m = line.match(MED_LINE);
        if (m) {
          const parts = m[1].split(/\s+(?=\d)/);
          findings.push({ kind: 'medication', text: m[1], drug: parts[0], docLabel });
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
            text: p.label + ' ' + m[1] + (p.unit ? ' ' + p.unit : ''), docLabel
          });
        }
      }

      /* Vitals */
      for (const p of VITAL_PATTERNS) {
        const m = line.match(p.re);
        if (m) findings.push({ kind: 'vital', label: p.label, rawValue: m[1], unit: p.unit, text: p.label + ' ' + m[1] + ' ' + p.unit, docLabel });
      }

      /* Anticoagulation interruption callouts */
      if (/apixaban|warfarin|anticoagul/i.test(line) && /held|resumed|interrupt|stopp/i.test(line)) {
        findings.push({ kind: 'anticoag-note', text: line, docLabel });
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
      if (!doc.imageDataUrl && !doc.fallbackText) continue;
      onStatus && onStatus(doc, 'running');

      let text = '', engine = 'none';
      if (doc.imageDataUrl) {
        const res = await ocrImage(doc.imageDataUrl);
        text = res.text; engine = res.engine;
      }
      if ((!text || text.trim().length < 40) && doc.fallbackText) {
        text = doc.fallbackText;
        engine = engine === 'tesseract' ? 'tesseract-lowconf-fallback' : 'fallback';
      }

      const docLabel = (doc.custodian || 'Outside facility') + ', ' + window.FhirData.fmtDate(doc.date);
      const findings = parseOutsideDocument(text, docLabel);
      doc.ocr = { text, engine, findings };

      findings.forEach(f => {
        vm.outsideFindings.push(f);
        if (f.kind === 'medication') {
          vm.outsideMeds.push({ text: f.text, dose: '', source: 'outside', docLabel, date: doc.date });
        }
        if (f.kind === 'lab' && !f.isNadir) {
          vm.outsideLabs.push({ loinc: f.loinc, label: f.label, value: f.value, unit: f.unit, effective: doc.date, source: 'outside', docLabel });
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
