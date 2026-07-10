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
    },
    {
      docRefId: 'doc-outside-fax',
      title: 'ST VINCENT COMMUNITY CLINIC — FAXED PROGRESS NOTE',
      /* Rendered as a badly degraded fax so Tesseract reads it with low
         confidence — exercises the low-OCR-confidence warning chips.
         Lines matching `smudge` get a pen-scrawl artifact appended, which
         OCRs as a garbage token and drags that line's confidence down. */
      messy: true,
      smudge: /platelets|assessment|prednisone/i,
      lines: [
        'ST VINCENT COMMUNITY CLINIC',
        'TRANSMITTED VIA FAX - IMAGE QUALITY REDUCED',
        '',
        'PROGRESS NOTE                Date: ' + dateDaysAgo(7),
        '',
        'Patient: DORIAN, JOHN M      DOB: 03/15/1954',
        'Provider: Robert Kelso, MD',
        '',
        'REASON FOR VISIT: Painful swollen left great toe',
        'x 2 days. No trauma.',
        '',
        'POINT OF CARE LABS:',
        'Platelets 152, INR 1.4',
        '',
        'ASSESSMENT: Acute gout flare, left foot',
        '',
        'NEW PRESCRIPTION:',
        '- Prednisone 20 mg daily for 5 days',
        '- Avoid NSAIDs due to recent GI bleed history',
        '',
        'INSTRUCTIONS: Ice and elevate. Follow up with',
        'primary care in 1 week. ER precautions reviewed.'
      ]
    }
  ];

  /**
   * Render a document's text as a simulated scanned page.
   * Returns a PNG data URL.
   */
  window.renderScannedDoc = function (doc) {
    const messy = !!doc.messy;
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

    // Scanner noise (heavy speckle on messy faxes)
    for (let i = 0; i < (messy ? 5000 : 900); i++) {
      ctx.fillStyle = 'rgba(0,0,0,' + (Math.random() * (messy ? 0.16 : 0.05)).toFixed(3) + ')';
      ctx.fillRect(Math.random() * width, Math.random() * height, messy && Math.random() < 0.3 ? 2 : 1, 1);
    }

    // Page skew, as if fed crooked through the scanner
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(messy ? -0.014 : -0.004);
    ctx.translate(-width / 2, -height / 2);

    ctx.fillStyle = messy ? '#5a564d' : '#1c1c22'; // faded toner on messy faxes
    ctx.font = '18px "Courier New", Courier, monospace';
    ctx.textBaseline = 'top';
    doc.lines.forEach((line, i) => {
      const wobble = messy ? Math.sin(i * 1.7) * 1.5 : 0; // uneven feed
      const y = pad + i * lineHeight + wobble;
      ctx.fillText(line, pad, y);
      if (messy && doc.smudge && line && doc.smudge.test(line)) {
        const endX = pad + ctx.measureText(line).width;
        drawScrawl(ctx, endX + 20, y + 9);
        /* The assessment line has many confident words diluting the garbage
           token's pull on its average confidence — annotate it twice. */
        if (/^assess/i.test(line)) drawScrawl(ctx, endX + 150, y + 9);
      }
    });
    ctx.restore();

    if (messy) degradeScan(canvas, ctx);

    // Fax-style header artifact
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.font = '11px monospace';
    ctx.fillText('SCANNED MEDIA - PAGE 1 OF 1', pad, 14);

    return canvas.toDataURL('image/png');
  };

  /* A short pen scrawl (margin annotation), unreadable by OCR — Tesseract
     picks it up as a low-confidence garbage token on the same line. */
  function drawScrawl(ctx, x, y) {
    ctx.save();
    ctx.strokeStyle = 'rgba(60,55,70,0.85)';
    ctx.lineWidth = 1.6;
    for (let pass = 0; pass < 3; pass++) {
      ctx.beginPath();
      let cx = x, cy = y + pass * 2 - 2;
      ctx.moveTo(cx, cy);
      for (let i = 0; i < 16; i++) {
        const nx = cx + 7 + Math.random() * 8;
        const ny = y + (Math.random() - 0.5) * 18;
        ctx.quadraticCurveTo(cx + 4, cy - 12 + Math.random() * 24, nx, ny);
        cx = nx; cy = ny;
      }
      ctx.stroke();
    }
    // ink blots
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = 'rgba(60,55,70,' + (0.4 + Math.random() * 0.4).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(x + Math.random() * 100, y + (Math.random() - 0.5) * 16, 1 + Math.random() * 2, 0, 7);
      ctx.fill();
    }
    ctx.restore();
  }

  /* Fax-transmission damage: toner dropout, streaks, and a downscale/upscale
     pass that blurs glyph edges — drives Tesseract line confidence down. */
  function degradeScan(canvas, ctx) {
    const { width, height } = canvas;

    // Toner dropout: paper-colored specks punched through the text
    for (let i = 0; i < 3200; i++) {
      ctx.fillStyle = 'rgba(246,243,234,' + (0.35 + Math.random() * 0.45).toFixed(2) + ')';
      ctx.fillRect(Math.random() * width, Math.random() * height, 1 + Math.random() * 2, 1);
    }

    // Horizontal fax streaks — some white (dropped rows), some dark
    for (let i = 0; i < 22; i++) {
      const y = Math.random() * height;
      ctx.fillStyle = Math.random() < 0.7
        ? 'rgba(246,243,234,0.6)'
        : 'rgba(40,40,40,0.12)';
      ctx.fillRect(0, y, width, 1 + Math.random() * 2);
    }

    // Resample down and back up to smear glyph edges
    const s = document.createElement('canvas');
    s.width = Math.max(1, Math.round(width * 0.53));
    s.height = Math.max(1, Math.round(height * 0.53));
    const sc = s.getContext('2d');
    sc.imageSmoothingEnabled = true;
    sc.drawImage(canvas, 0, 0, s.width, s.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(s, 0, 0, s.width, s.height, 0, 0, width, height);
  }
})();
