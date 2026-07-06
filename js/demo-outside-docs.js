/**
 * demo-outside-docs.js
 * Generates the "scanned outside media" images for demo mode.
 *
 * Each document below is rendered to an offscreen canvas as a slightly skewed,
 * noisy, off-white page — simulating paper records scanned into Epic media.
 * The resulting PNG is attached (base64) to the matching DocumentReference in
 * the demo bundle, and then the app OCRs it with Tesseract.js exactly as it
 * would OCR a Binary fetched from a live FHIR server. Nothing in these text
 * blocks is read directly by the app — only the OCR output is used (with the
 * raw text kept as a fallback if OCR is unavailable offline).
 */

(function () {
  const NOW = new Date();
  function dateDaysAgo(n) {
    const d = new Date(NOW);
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  }

  window.DEMO_OUTSIDE_DOCS = [
    {
      docRefId: 'doc-outside-discharge',
      title: 'SACRED HEART HOSPITAL — DISCHARGE SUMMARY',
      lines: [
        'SACRED HEART HOSPITAL',
        '402 Riverside Drive - Medical Records: (555) 014-9000',
        '',
        'DISCHARGE SUMMARY',
        '',
        'Patient: DORIAN, JOHN M       DOB: 03/15/1954',
        'Admit: ' + dateDaysAgo(64) + '    Discharge: ' + dateDaysAgo(59),
        'Attending: Percival Cox, MD   Consult: GI - C. Turk, MD',
        '',
        'DISCHARGE DIAGNOSES:',
        '1. Acute upper GI hemorrhage due to duodenal ulcer',
        '2. Acute blood loss anemia requiring transfusion',
        '3. Atrial fibrillation - anticoagulation interrupted',
        '',
        'HOSPITAL COURSE: Presented with melena and syncope.',
        'Hemoglobin nadir 7.1 g/dL. Transfused 2 units PRBC.',
        'EGD: 8 mm duodenal ulcer with visible vessel, treated',
        'with epinephrine injection and thermal coagulation.',
        'H. pylori negative. Apixaban HELD during admission and',
        'RESUMED at discharge per cardiology risk assessment.',
        '',
        'DISCHARGE LABS: Hemoglobin 10.8 g/dL, Platelets 176,',
        'Creatinine 1.7 mg/dL, INR 1.1',
        '',
        'DISCHARGE MEDICATIONS:',
        '- Pantoprazole 40 mg twice daily x 8 weeks, then daily',
        '- Apixaban 5 mg twice daily (resumed)',
        '- Continue home metoprolol, furosemide, insulin',
        '',
        'FOLLOW-UP: Repeat EGD in 8 weeks. Repeat CBC in 1 week.',
        'AVOID NSAIDS. Return precautions for melena reviewed.'
      ]
    },
    {
      docRefId: 'doc-outside-urgentcare',
      title: 'WELLNOW URGENT CARE — AFTER VISIT SUMMARY',
      lines: [
        'WELLNOW URGENT CARE',
        'A Sacred Heart Health Affiliate',
        '',
        'AFTER VISIT SUMMARY          Date: ' + dateDaysAgo(4),
        '',
        'Patient: DORIAN, JOHN M      DOB: 03/15/1954',
        'Provider: Douglas Murphy, MD',
        '',
        'REASON FOR VISIT: Burning with urination x 3 days,',
        'urinary frequency, mild fatigue.',
        '',
        'VITALS: Temp 37.9 C  HR 104  BP 108/64  SpO2 95%',
        '',
        'RESULTS: Urine dipstick - positive nitrites, positive',
        'leukocyte esterase, trace blood.',
        '',
        'ASSESSMENT: Urinary tract infection',
        '',
        'NEW PRESCRIPTION:',
        '- Ciprofloxacin 500 mg twice daily for 7 days',
        '  (Penicillin and sulfa allergies noted)',
        '',
        'INSTRUCTIONS: Push fluids. Urine culture sent - will',
        'call with results. Go to ER for fever, back pain,',
        'vomiting, or confusion.'
      ]
    }
  ];

  /**
   * Render a document's text as a simulated scanned page.
   * Returns a PNG data URL.
   */
  window.renderScannedDoc = function (doc) {
    const lineHeight = 26;
    const pad = 46;
    const width = 760;
    const height = pad * 2 + doc.lines.length * lineHeight + 30;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Aged-paper background
    ctx.fillStyle = '#f6f3ea';
    ctx.fillRect(0, 0, width, height);

    // Light scanner noise
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.05).toFixed(3) + ')';
      ctx.fillRect(Math.random() * width, Math.random() * height, 1, 1);
    }

    // Slight page skew, as if fed crooked through the scanner
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(-0.004);
    ctx.translate(-width / 2, -height / 2);

    ctx.fillStyle = '#1c1c22';
    ctx.font = '18px "Courier New", Courier, monospace';
    ctx.textBaseline = 'top';
    doc.lines.forEach((line, i) => {
      ctx.fillText(line, pad, pad + i * lineHeight);
    });
    ctx.restore();

    // Fax-style header artifact
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.font = '11px monospace';
    ctx.fillText('SCANNED MEDIA - PAGE 1 OF 1', pad, 14);

    return canvas.toDataURL('image/png');
  };
})();
