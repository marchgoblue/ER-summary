/**
 * app.js
 * Bootstraps the ER One-Page Summary in either mode:
 *   - Live SMART on FHIR (EHR launch via launch.html, or standalone launch)
 *   - Demo mode (?demo, or automatically when no SMART context exists)
 * and renders the one-page view.
 */

(function () {
  const { buildViewModel, fetchLiveResources, fmtDate, fmtTime, relDate } = window.FhirData;

  /* UI state (persisted where it makes sense) */
  const ui = {
    theme: localStorage.getItem('ers-theme') || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    medSort: localStorage.getItem('ers-medsort') || 'priority',
    trayOpen: false
  };
  let VM = null;
  let LIVE_CLIENT = null;
  let refreshing = false;
  const AUTO_REFRESH_MS = 2 * 60 * 1000; // live mode polls the FHIR server every 2 min

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function el(id) { return document.getElementById(id); }

  /* ------------------------------------------------------------ bootstrap */

  async function init() {
    applyTheme();
    el('theme-toggle').addEventListener('click', () => {
      ui.theme = ui.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('ers-theme', ui.theme);
      applyTheme();
    });
    el('tray-toggle').addEventListener('click', () => setTray(!ui.trayOpen));
    el('refresh-btn').addEventListener('click', refresh);

    const params = new URLSearchParams(location.search);
    const wantDemo = params.has('demo');

    if (!wantDemo && typeof FHIR !== 'undefined') {
      try {
        const client = await FHIR.oauth2.ready();
        return startLive(client);
      } catch (e) {
        console.info('No SMART launch context — starting demo mode.', e);
      }
    }
    startDemo();
  }

  function applyTheme() {
    document.documentElement.dataset.theme = ui.theme;
    el('theme-toggle').textContent = ui.theme === 'dark' ? 'Light' : 'Dark';
  }

  function setTray(open) {
    ui.trayOpen = open;
    el('tray').classList.toggle('open', open);
    el('tray-backdrop').classList.toggle('open', open);
  }

  function startDemo() {
    el('mode-badge').textContent = 'Demo — simulated patient';
    el('mode-badge').classList.add('demo');
    const resources = window.DEMO_BUNDLE.entry.map(e => e.resource);
    const vm = buildViewModel(resources);

    /* Generate the "scanned" outside documents and attach them, then OCR. */
    vm.outsideDocs.forEach(doc => {
      const src = (window.DEMO_OUTSIDE_DOCS || []).find(d => d.docRefId === doc.id);
      if (src) {
        doc.imageDataUrl = window.renderScannedDoc(src);
        doc.fallbackText = src.lines.join('\n');
      }
    });

    VM = vm;
    renderAll();
    runOcr(vm);
  }

  async function startLive(client) {
    LIVE_CLIENT = client;
    el('mode-badge').textContent = 'Connected — live FHIR data';
    el('mode-badge').classList.add('live');
    setLoading('Loading chart from FHIR server…');
    const resources = await fetchLiveResources(client);
    const vm = buildViewModel(resources);
    await resolveAttachments(client, vm);

    VM = vm;
    renderAll();
    runOcr(vm);
    setInterval(refresh, AUTO_REFRESH_MS);
  }

  /** Resolve scanned-media attachments (Binary) for OCR. */
  async function resolveAttachments(client, vm) {
    for (const doc of vm.outsideDocs) {
      const att = doc.attachment;
      if (!att || doc.imageDataUrl) continue;
      try {
        if (att.data) {
          doc.imageDataUrl = 'data:' + (att.contentType || 'image/png') + ';base64,' + att.data;
        } else if (att.url && /^image\//.test(att.contentType || '')) {
          const res = await client.request(att.url, { includeResponse: true });
          const b = res.response ? await res.response.blob() : null;
          if (b) doc.imageDataUrl = await blobToDataUrl(b);
        }
      } catch (e) {
        console.warn('Could not fetch attachment for', doc.id, e);
      }
    }
  }

  /**
   * Re-pull data and re-render. In live mode this re-queries the FHIR server
   * (new labs/vitals/orders appear as they result); in demo mode it re-runs
   * the same pipeline. OCR results are carried over per document so scans are
   * only OCR'd once.
   */
  async function refresh() {
    if (refreshing || !VM) return;
    refreshing = true;
    el('refresh-btn').classList.add('busy');
    try {
      const resources = LIVE_CLIENT
        ? await fetchLiveResources(LIVE_CLIENT)
        : window.DEMO_BUNDLE.entry.map(e => e.resource);
      const vm = buildViewModel(resources);

      /* Carry over generated images + OCR results for documents we already processed. */
      vm.outsideDocs.forEach(doc => {
        const prev = VM.outsideDocs.find(d => d.id === doc.id);
        if (prev) {
          doc.imageDataUrl = prev.imageDataUrl;
          doc.fallbackText = prev.fallbackText;
          doc.ocr = prev.ocr;
        } else if (!LIVE_CLIENT) {
          const src = (window.DEMO_OUTSIDE_DOCS || []).find(d => d.docRefId === doc.id);
          if (src) {
            doc.imageDataUrl = window.renderScannedDoc(src);
            doc.fallbackText = src.lines.join('\n');
          }
        }
      });
      if (LIVE_CLIENT) await resolveAttachments(LIVE_CLIENT, vm);

      VM = vm;
      renderAll();
      runOcr(vm);
    } catch (e) {
      console.warn('Refresh failed:', e);
    } finally {
      refreshing = false;
      el('refresh-btn').classList.remove('busy');
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  function runOcr(vm) {
    if (!vm.outsideDocs.length) return;
    window.Ocr.processOutsideDocs(vm, (doc, state) => {
      const n = el('ocr-status');
      if (n) n.textContent = state === 'running' ? 'Reading scanned outside records (OCR)…' : '';
    }).then(() => {
      renderAll(); // re-render with outside data merged + flags recomputed
      const n = el('ocr-status');
      if (n) n.textContent = '';
    });
  }

  function setLoading(msg) {
    el('main').innerHTML = '<div class="loading">' + esc(msg) + '</div>';
  }

  /* --------------------------------------------------------- shared bits */

  function outsideBadge(docId) {
    return `<span class="badge-outside tip" data-doc-id="${esc(docId || '')}" data-tip="Outside record — click to view the scanned source document">OUTSIDE</span>`;
  }

  function openDocViewer(doc) {
    if (!doc || !doc.imageDataUrl) return;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = `<div class="overlay-inner"><img src="${doc.imageDataUrl}" alt="Scanned document"><div class="overlay-hint">${esc(doc.type)} — ${esc(doc.custodian)} · click anywhere to close</div></div>`;
    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
  }

  /* ------------------------------------------------------------ rendering */

  function renderAll() {
    const vm = VM;
    const flags = window.RiskEngine.computeFlags(vm);
    const scores = window.RiskEngine.computeScores(vm);

    el('main').innerHTML = `
      ${renderBanner(vm)}
      ${renderSummary(vm, flags, scores)}
      ${renderFlags(flags)}
      <div class="grid">
        <section class="col">
          <h2>This ED visit ${vm.currentEncounter ? '<span class="sub">arrived ' + esc(fmtTime(vm.currentEncounter.period.start)) + '</span>' : ''}</h2>
          ${renderVitals(vm)}
          ${renderScores(scores)}
          ${renderEcg(vm)}
          ${renderCurrentLabs(vm)}
          ${renderImaging(vm)}
        </section>
        <section class="col">
          <h2>Background</h2>
          ${renderMeds(vm)}
          ${renderProblems(vm)}
          ${renderAllergies(vm)}
          ${renderDevices(vm)}
        </section>
      </div>
      <footer>Data shown is limited to FHIR R4 resources (Patient, Encounter, Condition, MedicationRequest, AllergyIntolerance, Observation, DiagnosticReport, DocumentReference, Device) and values computed from them. Demo patient is fictitious. Not for clinical use.</footer>
    `;

    el('tray-body').innerHTML = renderEncounters(vm) + renderOutsideDocs(vm);

    /* Edge tab: surface how much is waiting in the tray */
    const nDocs = vm.outsideDocs.length;
    el('tray-toggle').innerHTML =
      (nDocs ? `<span class="edge-count">${nDocs}</span>` : '') +
      `<span class="edge-label">Outside records &amp; visits</span>`;
    el('tray-toggle').classList.toggle('has-docs', nDocs > 0);

    el('refresh-btn').innerHTML = '&#x21bb; <span class="refresh-time">updated ' + esc(fmtTime(new Date().toISOString())) + '</span>';

    bindInteractions(vm);
  }

  function renderBanner(vm) {
    const p = vm.patient;
    const sev = vm.allergies.filter(a => a.criticality === 'high').map(a => a.text).join(', ');
    return `
      <div class="banner">
        <div class="banner-name">
          <span class="pt-name">${esc(p.name)}</span>
          <span class="pt-meta">${p.age != null ? p.age + ' yo' : ''} ${esc(p.gender)} · DOB ${esc(fmtDate(p.dob))} · MRN ${esc(p.mrn)}</span>
        </div>
        <div class="banner-allergy ${sev ? '' : 'none'}">${sev ? 'Allergies: ' + esc(sev) : 'No high-risk allergies recorded'}</div>
      </div>`;
  }

  function renderSummary(vm, flags, scores) {
    const html = window.Summary.generateSummary(vm, flags, scores);
    if (!html) return '';
    return `<div class="card summary-card">${html}</div>`;
  }

  function renderFlags(flags) {
    if (!flags.length) return '';
    const chip = f => `
      <span class="flag ${f.level} tip" data-tip="${esc(f.detail || f.label)}">
        <span class="dot"></span>${esc(f.label)}${f.source === 'outside' ? outsideBadge(f.docId) : ''}
      </span>`;
    return card('Attention <span class="sub">hover for detail</span>', `<div class="flag-list">${flags.map(chip).join('')}</div>`);
  }

  function renderVitals(vm) {
    const cur = vm.vitals.filter(v => v.thisVisit);
    if (!cur.length) return card('Triage vitals', '<div class="empty">No vitals recorded this visit</div>');

    const order = ['8310-5', '8867-4', '85354-9', '9279-1', '59408-5', '9269-2', '29463-7'];
    const byLoinc = {};
    cur.forEach(v => (byLoinc[v.loinc] = byLoinc[v.loinc] || []).push(v));

    const rows = order.filter(l => byLoinc[l]).map(l => {
      const series = byLoinc[l];
      const first = series[0], last = series[series.length - 1];
      const disp = v => {
        if (v.loinc === '85354-9') {
          const { sbp, dbp } = window.RiskEngine.bpComponents(v);
          return sbp + '/' + dbp;
        }
        return v.display;
      };
      const abn = ['H', 'L', 'A'].includes(first.interp);
      const trend = series.length > 1 ? `<span class="trend">→ ${esc(disp(last))} <span class="faint">@ ${esc(fmtTime(last.effective))}</span></span>` : '';
      const note = first.note || last.note;
      return `<tr class="${abn ? 'abn' : ''}">
        <td>${esc(first.label)}</td>
        <td class="val">${esc(disp(first))} ${trend}</td>
        <td class="muted">${esc(fmtTime(first.effective))}${note ? ' · ' + esc(note) : ''}</td>
      </tr>`;
    }).join('');

    return card('Triage vitals <span class="sub">first → latest</span>', `<table class="tbl">${rows}</table>`);
  }

  function renderScores(scores) {
    if (!scores.length) return '';
    const cells = scores.map(s => `
      <div class="score ${s.danger ? 'danger' : ''} tip" data-tip="${esc(s.detail)}">
        <div class="score-name">${esc(s.name)}</div>
        <div class="score-val">${esc(s.value)}</div>
      </div>`).join('');
    return card('Computed scores <span class="sub">derived from FHIR vitals &amp; labs — hover for inputs</span>', `<div class="scores">${cells}</div>`);
  }

  function renderEcg(vm) {
    const ecgs = vm.reports.filter(r => r.kind === 'ecg' && r.thisVisit);
    if (!ecgs.length) return card('ECG', '<div class="empty">No ECG this visit</div>');
    return card('ECG', ecgs.map(r => `
      <div class="report">
        <div class="report-head">${esc(r.label)} <span class="faint">${esc(fmtTime(r.effective))}</span></div>
        <div class="report-body ecg-text">${esc(r.conclusion)}</div>
      </div>`).join(''));
  }

  function renderCurrentLabs(vm) {
    if (!vm.labsCurrent.length) return card('Labs since arrival', '<div class="empty">No labs resulted yet</div>');
    const rows = vm.labsCurrent.slice().sort((a, b) => new Date(a.effective) - new Date(b.effective)).map(l => {
      const prior = typeof l.value === 'number' ? vm.priorByLoinc[l.loinc] : null;
      let delta = '';
      if (prior && typeof prior.value === 'number') {
        const d = l.value - prior.value;
        const arrow = d > 0 ? '↑' : d < 0 ? '↓' : '=';
        const cls = Math.abs(d) / Math.max(Math.abs(prior.value), 0.01) >= 0.2 ? 'delta-big' : 'delta';
        delta = `<span class="${cls}">${arrow} from ${esc(String(prior.value))} <span class="faint">${esc(relDate(prior.effective))}</span></span>${prior.source === 'outside' ? outsideBadge(prior.docId) : ''}`;
      }
      const pending = l.status === 'registered' || l.status === 'preliminary';
      const abn = ['H', 'L', 'HH', 'LL', 'A'].includes(l.interp);
      return `<tr class="${abn ? 'abn' : ''} ${pending ? 'pending' : ''}">
        <td>${esc(l.label)}</td>
        <td class="val">${pending ? 'Pending' : esc(l.display)}${abn ? '<span class="interp">' + esc(l.interp) + '</span>' : ''}</td>
        <td>${delta}</td>
        <td class="muted">${esc(l.ref)}</td>
        <td class="muted">${esc(fmtTime(l.effective))}${l.note ? ' · ' + esc(l.note) : ''}</td>
      </tr>`;
    }).join('');
    return card('Labs since arrival <span class="sub">change vs most recent prior, incl. outside records</span>',
      `<table class="tbl labs"><tr class="hd"><th>Test</th><th>Result</th><th>Change</th><th>Ref</th><th>Time</th></tr>${rows}</table>`);
  }

  function renderImaging(vm) {
    const imgs = vm.reports.filter(r => (r.kind === 'imaging' || r.kind === 'echo') && r.thisVisit);
    const prior = vm.reports.filter(r => (r.kind === 'imaging' || r.kind === 'echo' || r.kind === 'other') && !r.thisVisit).slice(0, 2);
    let html = imgs.length ? imgs.map(r => `
      <div class="report">
        <div class="report-head">${esc(r.label)} <span class="faint">${esc(fmtTime(r.effective))}</span>${r.status !== 'final' ? '<span class="badge-pending">' + esc(r.status === 'registered' ? 'ordered' : r.status) + '</span>' : ''}</div>
        <div class="report-body">${esc(r.conclusion)}</div>
      </div>`).join('') : '<div class="empty">No imaging this visit</div>';
    if (prior.length) {
      html += '<div class="subhead">Recent prior studies</div>' + prior.map(r => `
        <div class="report prior">
          <div class="report-head">${esc(r.label)} <span class="faint">${esc(relDate(r.effective))}</span></div>
          <div class="report-body">${esc(r.conclusion)}</div>
        </div>`).join('');
    }
    return card('Imaging', html);
  }

  /* ------------------------------------------------------------- meds */

  const HIGH_RISK_MED = /apixaban|rivaroxaban|warfarin|dabigatran|enoxaparin|heparin|clopidogrel|ticagrelor|insulin|amiodarone|digoxin|methotrexate|prednisone/i;

  const MED_CLASSES = [
    ['Anticoagulation / antiplatelet', /apixaban|rivaroxaban|warfarin|dabigatran|edoxaban|enoxaparin|heparin|clopidogrel|ticagrelor|prasugrel|aspirin/i],
    ['Cardiovascular', /metoprolol|carvedilol|atenolol|bisoprolol|amiodarone|digoxin|lisinopril|losartan|valsartan|sacubitril|amlodipine|hydralazine|isosorbide|furosemide|bumetanide|torsemide|spironolactone|atorvastatin|rosuvastatin|simvastatin|statin/i],
    ['Diabetes', /insulin|glargine|lispro|aspart|metformin|glipizide|glyburide|empagliflozin|dapagliflozin|semaglutide|liraglutide|sitagliptin/i],
    ['Pulmonary', /tiotropium|albuterol|ipratropium|budesonide|fluticasone|salmeterol|formoterol|montelukast/i],
    ['Anti-infective', /cillin|cycline|floxacin|azithromycin|cephalexin|ceftriaxone|vancomycin|metronidazole|nitrofurantoin|trimethoprim|sulfamethoxazole/i],
    ['GI', /pantoprazole|omeprazole|esomeprazole|famotidine|sucralfate|ondansetron/i]
  ];

  function medClass(text) {
    for (const [name, re] of MED_CLASSES) if (re.test(text)) return name;
    return 'Other';
  }

  function renderMeds(vm) {
    const all = vm.meds.map(m => ({ ...m }))
      .concat((vm.outsideMeds || []).map(m => ({ ...m, recentChange: true })));
    if (!all.length) return card('Medications', '<div class="empty">No active medications</div>');

    const sort = ui.medSort;
    let body = '';
    const medRow = m => `
      <div class="med">
        <div class="med-line">
          ${HIGH_RISK_MED.test(m.text) ? '<span class="risk-mark tip" data-tip="High-risk medication">●</span>' : ''}${esc(m.text)}
          ${m.source === 'outside' ? outsideBadge(m.docId) : ''}
          ${m.recentChange && m.source !== 'outside' ? '<span class="badge-change">changed ' + esc(relDate(m.authoredOn)) + '</span>' : ''}
          ${m.source === 'outside' ? '<span class="badge-change">new ' + esc(relDate(m.date || '')) + '</span>' : ''}
        </div>
        <div class="med-dose">${esc(m.dose)}${m.source === 'outside' && m.docLabel ? (m.dose ? ' — ' : '') + 'per ' + esc(m.docLabel) : ''}</div>
        ${m.priorDose ? '<div class="med-dose faint">previously ' + esc(m.priorDose) + ' (prior order, discontinued)</div>' : ''}
        ${m.note ? '<div class="med-note">' + esc(m.note) + '</div>' : ''}
      </div>`;

    if (sort === 'alpha') {
      body = all.slice().sort((a, b) => a.text.localeCompare(b.text)).map(medRow).join('');
    } else if (sort === 'class') {
      const groups = {};
      all.forEach(m => (groups[medClass(m.text)] = groups[medClass(m.text)] || []).push(m));
      const names = MED_CLASSES.map(c => c[0]).concat('Other').filter(n => groups[n]);
      body = names.map(n =>
        `<div class="med-class-head">${esc(n)}</div>` +
        groups[n].sort((a, b) => a.text.localeCompare(b.text)).map(medRow).join('')
      ).join('');
    } else { // priority
      body = all.slice().sort((a, b) => {
        const risk = (HIGH_RISK_MED.test(b.text) ? 1 : 0) - (HIGH_RISK_MED.test(a.text) ? 1 : 0);
        if (risk) return risk;
        return (b.recentChange ? 1 : 0) - (a.recentChange ? 1 : 0);
      }).map(medRow).join('');
    }

    const sortBtn = (key, label) =>
      `<button class="sort-btn ${sort === key ? 'active' : ''}" data-medsort="${key}">${label}</button>`;
    return `<div class="card">
      <div class="card-head-row">
        <h3>Medications</h3>
        <div class="sort-control">${sortBtn('priority', 'Priority')}${sortBtn('alpha', 'A–Z')}${sortBtn('class', 'Class')}</div>
      </div>${body}</div>`;
  }

  function renderProblems(vm) {
    const outsideDx = (vm.outsideFindings || []).filter(f => f.kind === 'diagnosis');
    if (!vm.conditions.length && !outsideDx.length) return card('Active problems', '<div class="empty">No problems recorded</div>');
    const li = vm.conditions.map(c =>
      `<li>${esc(c.text)}${c.note ? ' <span class="muted">— ' + esc(c.note) + '</span>' : ''}</li>`).join('');
    const lo = outsideDx.map(f =>
      `<li>${esc(f.text)}${outsideBadge(f.docId)} <span class="muted">— ${esc(f.docLabel)}</span></li>`).join('');
    return card('Active problems', `<ul class="plain-list">${li}${lo}</ul>`);
  }

  function renderAllergies(vm) {
    if (!vm.allergies.length) return card('Allergies', '<div class="empty">No known allergies</div>');
    const rows = vm.allergies.map(a => `
      <div class="allergy ${a.criticality === 'high' ? 'high' : ''}">
        <b>${esc(a.text)}</b> — ${esc(a.reaction || 'reaction not documented')}
        ${a.severity ? '<span class="muted">(' + esc(a.severity) + ')</span>' : ''}
      </div>`).join('');
    return card('Allergies', rows);
  }

  function renderDevices(vm) {
    if (!vm.devices.length) return '';
    const rows = vm.devices.map(d => `
      <div class="device"><b>${esc(d.text)}</b>${d.detail ? ' — ' + esc(d.detail) : ''}
      ${d.note ? '<div class="muted">' + esc(d.note) + '</div>' : ''}</div>`).join('');
    return card('Implanted devices', rows);
  }

  /* --------------------------------------------------------- tray content */

  function renderEncounters(vm) {
    if (!vm.pastEncounters.length) return card('Recent visits &amp; hospitalizations', '<div class="empty">None on file</div>');
    const rows = vm.pastEncounters.map(e => {
      const cls = e.class && e.class.code;
      const kind = cls === 'IMP' ? 'Hospital' : cls === 'EMER' ? 'ED' : 'Clinic';
      const start = e.period && e.period.start;
      const end = e.period && e.period.end;
      const los = (cls === 'IMP' && start && end) ? Math.max(1, Math.round((new Date(end) - new Date(start)) / 86400000)) + ' d' : '';
      const who = (e.participant && e.participant[0] && e.participant[0].individual && e.participant[0].individual.display) || (e.serviceProvider && e.serviceProvider.display) || '';
      return `
        <div class="enc">
          <div class="enc-head"><span class="enc-kind ${kind.toLowerCase()}">${kind}</span>
            <b>${esc(relDate(start))}</b> <span class="faint">${esc(fmtDate(start))}${los ? ' · LOS ' + los : ''}</span></div>
          <div class="enc-body">${esc(e.reasonCode ? window.FhirData.ccText(e.reasonCode[0]) : (e.type && window.FhirData.ccText(e.type[0])) || '')}</div>
          ${who ? '<div class="faint enc-who">' + esc(who) + '</div>' : ''}
        </div>`;
    }).join('');
    return card('Recent visits &amp; hospitalizations', rows);
  }

  function renderOutsideDocs(vm) {
    if (!vm.outsideDocs.length) return card('Outside records (scanned media)', '<div class="empty">None on file</div>');
    const rows = vm.outsideDocs.map((doc, i) => {
      const o = doc.ocr;
      let extracted = '<div class="muted">Running OCR on scanned document…</div>';
      if (o) {
        const groups = [
          ['Diagnoses', o.findings.filter(f => f.kind === 'diagnosis')],
          ['Medications', o.findings.filter(f => f.kind === 'medication')],
          ['Labs', o.findings.filter(f => f.kind === 'lab')],
          ['Vitals', o.findings.filter(f => f.kind === 'vital')],
          ['Anticoagulation', o.findings.filter(f => f.kind === 'anticoag-note')]
        ].filter(g => g[1].length);
        extracted = groups.map(([title, items]) =>
          `<div class="subhead">${title}</div><ul class="plain-list">` +
          items.map(f => `<li>${esc(f.text)}${f.isNadir ? ' <span class="muted">(nadir)</span>' : ''}</li>`).join('') +
          '</ul>').join('') +
          `<div class="ocr-engine">${o.engine === 'tesseract' ? 'Extracted via OCR (Tesseract.js)' : 'OCR unavailable — simulated extraction from document text'}</div>`;
      }
      return `
        <div class="doc">
          <div class="doc-head">${outsideBadge(doc.id)}${esc(doc.type)}</div>
          <div class="muted">${esc(doc.custodian)}${doc.author ? ' · ' + esc(doc.author) : ''} · ${esc(fmtDate(doc.date))} (${esc(relDate(doc.date))})</div>
          <div class="doc-desc">${esc(doc.description)}</div>
          ${doc.imageDataUrl ? `<button class="doc-view" data-doc-id="${esc(doc.id)}">View scanned image</button>` : ''}
          <div class="doc-extract">${extracted}</div>
        </div>`;
    }).join('');
    return card('Outside records (scanned media) <span class="sub">discrete data extracted via OCR</span>', rows);
  }

  /* --------------------------------------------------------- interactions */

  function bindInteractions(vm) {
    /* OUTSIDE badges + "View scanned image" buttons open the source document */
    document.querySelectorAll('[data-doc-id]').forEach(node => {
      node.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const doc = vm.outsideDocs.find(d => d.id === node.dataset.docId);
        openDocViewer(doc);
      });
    });

    /* Medication sort control */
    document.querySelectorAll('[data-medsort]').forEach(btn => {
      btn.addEventListener('click', () => {
        ui.medSort = btn.dataset.medsort;
        localStorage.setItem('ers-medsort', ui.medSort);
        renderAll();
      });
    });
  }

  function card(title, body) {
    return `<div class="card"><h3>${title}</h3>${body}</div>`;
  }

  window.addEventListener('load', init);
})();
