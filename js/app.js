/**
 * app.js
 * Bootstraps the ER One-Page Summary in either mode:
 *   - Live SMART on FHIR (EHR launch via launch.html, or standalone launch)
 *   - Demo mode (?demo, or automatically when no SMART context exists)
 * and renders the one-page view.
 */

(function () {
  const { buildViewModel, fetchLiveResources, fmtDate, fmtTime, relDate } = window.FhirData;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function el(id) { return document.getElementById(id); }

  /* ------------------------------------------------------------ bootstrap */

  async function init() {
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

  function startDemo() {
    el('mode-badge').textContent = 'DEMO MODE — simulated patient';
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

    renderAll(vm);
    runOcr(vm);
  }

  async function startLive(client) {
    el('mode-badge').textContent = 'CONNECTED — live FHIR data';
    el('mode-badge').classList.add('live');
    setLoading('Loading chart from FHIR server…');
    const resources = await fetchLiveResources(client);
    const vm = buildViewModel(resources);

    /* Resolve scanned-media attachments (Binary) for OCR. */
    for (const doc of vm.outsideDocs) {
      const att = doc.attachment;
      if (!att) continue;
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

    renderAll(vm);
    runOcr(vm);
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
      if (n) n.textContent = state === 'running'
        ? 'OCR in progress: ' + doc.type + '…'
        : 'OCR complete: ' + doc.type;
    }).then(() => {
      renderAll(vm); // re-render with outside data merged + flags recomputed
      const n = el('ocr-status');
      if (n) n.textContent = '';
    });
  }

  function setLoading(msg) {
    el('main').innerHTML = '<div class="loading">' + esc(msg) + '</div>';
  }

  /* ------------------------------------------------------------ rendering */

  function renderAll(vm) {
    const flags = window.RiskEngine.computeFlags(vm);
    const scores = window.RiskEngine.computeScores(vm);

    el('main').innerHTML = `
      ${renderBanner(vm)}
      ${renderFlags(flags)}
      <div class="grid">
        <section class="col">
          <h2>This ED visit ${vm.currentEncounter ? '<span class="sub">arrived ' + esc(fmtTime(vm.currentEncounter.period.start)) + (vm.currentEncounter.reasonCode ? ' — ' + esc(window.FhirData.ccText(vm.currentEncounter.reasonCode[0])) : '') + '</span>' : ''}</h2>
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
        <section class="col">
          <h2>Recent care &amp; outside records</h2>
          ${renderEncounters(vm)}
          ${renderOutsideDocs(vm)}
        </section>
      </div>
      <div id="ocr-status" class="ocr-status"></div>
      <footer>Data shown is limited to FHIR R4 resources (Patient, Encounter, Condition, MedicationRequest, AllergyIntolerance, Observation, DiagnosticReport, DocumentReference, Device). Demo patient is fictitious. Not for clinical use.</footer>
    `;
    bindDocViewers(vm);
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
        <div class="banner-allergy">${sev ? '⚠ High-risk allergies: <b>' + esc(sev) + '</b>' : 'No high-risk allergies recorded'}</div>
      </div>`;
  }

  function renderFlags(flags) {
    if (!flags.length) return '';
    const chip = f => `
      <div class="flag ${f.level}" title="${esc(f.detail)}">
        <span class="flag-label">${esc(f.label)}</span>
        ${f.detail ? '<span class="flag-detail">' + esc(f.detail) + '</span>' : ''}
        ${f.source === 'outside' ? '<span class="badge-outside">OUTSIDE</span>' : ''}
      </div>`;
    return `<div class="flags">${flags.map(chip).join('')}</div>`;
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
      const abn = first.interp === 'H' || first.interp === 'L' || first.interp === 'A';
      const trend = series.length > 1 ? `<span class="trend">→ ${esc(disp(last))} <span class="muted">@ ${esc(fmtTime(last.effective))}</span></span>` : '';
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
      <div class="score ${s.danger ? 'danger' : ''}" title="${esc(s.detail)}">
        <div class="score-name">${esc(s.name)}</div>
        <div class="score-val">${esc(s.value)}</div>
        <div class="score-detail">${esc(s.detail)}</div>
      </div>`).join('');
    return card('Computed scores <span class="sub">derived from FHIR vitals/labs</span>', `<div class="scores">${cells}</div>`);
  }

  function renderEcg(vm) {
    const ecgs = vm.reports.filter(r => r.kind === 'ecg' && r.thisVisit);
    if (!ecgs.length) return card('ECG', '<div class="empty">No ECG this visit</div>');
    return card('ECG', ecgs.map(r => `
      <div class="report">
        <div class="report-head">${esc(r.label)} <span class="muted">${esc(fmtTime(r.effective))}</span></div>
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
        const arrow = d > 0 ? '▲' : d < 0 ? '▼' : '＝';
        const cls = Math.abs(d) / Math.max(Math.abs(prior.value), 0.01) >= 0.2 ? 'delta-big' : 'delta';
        delta = `<span class="${cls}" title="prior ${esc(String(prior.value))} ${esc(relDate(prior.effective))}${prior.source === 'outside' ? ' (outside record)' : ''}">${arrow} from ${esc(String(prior.value))} <span class="muted">${esc(relDate(prior.effective))}</span>${prior.source === 'outside' ? ' <span class="badge-outside">OUTSIDE</span>' : ''}</span>`;
      }
      const pending = l.status === 'registered' || l.status === 'preliminary';
      const abn = ['H', 'L', 'HH', 'LL', 'A'].includes(l.interp);
      return `<tr class="${abn ? 'abn' : ''} ${pending ? 'pending' : ''}">
        <td>${esc(l.label)}</td>
        <td class="val">${pending ? 'PENDING' : esc(l.display)} ${abn ? '<span class="interp">' + esc(l.interp) + '</span>' : ''}</td>
        <td>${delta}</td>
        <td class="muted">${esc(l.ref)}</td>
        <td class="muted">${esc(fmtTime(l.effective))}${l.note ? ' · ' + esc(l.note) : ''}</td>
      </tr>`;
    }).join('');
    return card('Labs since arrival <span class="sub">Δ vs most recent prior (incl. outside records)</span>',
      `<table class="tbl labs"><tr class="hd"><th>Test</th><th>Result</th><th>Change</th><th>Ref</th><th>Time</th></tr>${rows}</table>`);
  }

  function renderImaging(vm) {
    const imgs = vm.reports.filter(r => (r.kind === 'imaging' || r.kind === 'echo') && r.thisVisit);
    const prior = vm.reports.filter(r => (r.kind === 'imaging' || r.kind === 'echo' || r.kind === 'other') && !r.thisVisit).slice(0, 2);
    let html = imgs.length ? imgs.map(r => `
      <div class="report">
        <div class="report-head">${esc(r.label)} <span class="muted">${esc(fmtTime(r.effective))}</span> ${r.status !== 'final' ? '<span class="badge-pending">' + esc(r.status.toUpperCase()) + '</span>' : ''}</div>
        <div class="report-body">${esc(r.conclusion)}</div>
      </div>`).join('') : '<div class="empty">No imaging this visit</div>';
    if (prior.length) {
      html += '<div class="subhead">Recent prior studies</div>' + prior.map(r => `
        <div class="report prior">
          <div class="report-head">${esc(r.label)} <span class="muted">${esc(relDate(r.effective))}</span></div>
          <div class="report-body">${esc(r.conclusion)}</div>
        </div>`).join('');
    }
    return card('Imaging', html);
  }

  function renderMeds(vm) {
    const HIGH_RISK = /apixaban|rivaroxaban|warfarin|dabigatran|enoxaparin|heparin|clopidogrel|ticagrelor|insulin|amiodarone|digoxin|methotrexate|prednisone/i;
    const all = vm.meds.map(m => ({ ...m }))
      .concat((vm.outsideMeds || []).map(m => ({ ...m, recentChange: true })));
    if (!all.length) return card('Medications', '<div class="empty">No active medications</div>');

    all.sort((a, b) => {
      const risk = (HIGH_RISK.test(b.text) ? 1 : 0) - (HIGH_RISK.test(a.text) ? 1 : 0);
      if (risk) return risk;
      return (b.recentChange ? 1 : 0) - (a.recentChange ? 1 : 0);
    });

    const rows = all.map(m => `
      <div class="med ${HIGH_RISK.test(m.text) ? 'high-risk' : ''}">
        <div class="med-line">
          <b>${esc(m.text)}</b>
          ${m.source === 'outside' ? '<span class="badge-outside">OUTSIDE</span>' : ''}
          ${m.recentChange && m.source !== 'outside' ? '<span class="badge-change">CHANGED ' + esc(relDate(m.authoredOn)).toUpperCase() + '</span>' : ''}
          ${m.source === 'outside' ? '<span class="badge-change">NEW ' + esc(relDate(m.date || '')).toUpperCase() + '</span>' : ''}
        </div>
        <div class="med-dose">${esc(m.dose)}${m.source === 'outside' && m.docLabel ? ' — per ' + esc(m.docLabel) : ''}</div>
        ${m.note ? '<div class="med-note">' + esc(m.note) + '</div>' : ''}
      </div>`).join('');
    return card('Medications <span class="sub">high-risk &amp; recent changes first</span>', rows);
  }

  function renderProblems(vm) {
    const outsideDx = (vm.outsideFindings || []).filter(f => f.kind === 'diagnosis');
    if (!vm.conditions.length && !outsideDx.length) return card('Active problems', '<div class="empty">No problems recorded</div>');
    const li = vm.conditions.map(c =>
      `<li><b>${esc(c.text)}</b>${c.note ? ' <span class="muted">— ' + esc(c.note) + '</span>' : ''}</li>`).join('');
    const lo = outsideDx.map(f =>
      `<li class="outside-item"><b>${esc(f.text)}</b> <span class="badge-outside">OUTSIDE</span> <span class="muted">— ${esc(f.docLabel)}</span></li>`).join('');
    return card('Active problems', `<ul class="problems">${li}${lo}</ul>`);
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

  function renderEncounters(vm) {
    if (!vm.pastEncounters.length) return card('Recent visits &amp; hospitalizations', '<div class="empty">None on file</div>');
    const rows = vm.pastEncounters.map(e => {
      const cls = e.class && e.class.code;
      const kind = cls === 'IMP' ? 'HOSPITAL' : cls === 'EMER' ? 'ED' : 'CLINIC';
      const start = e.period && e.period.start;
      const end = e.period && e.period.end;
      const los = (cls === 'IMP' && start && end) ? Math.max(1, Math.round((new Date(end) - new Date(start)) / 86400000)) + ' d' : '';
      const who = (e.participant && e.participant[0] && e.participant[0].individual && e.participant[0].individual.display) || (e.serviceProvider && e.serviceProvider.display) || '';
      return `
        <div class="enc ${kind.toLowerCase()}">
          <div class="enc-head"><span class="enc-kind ${kind.toLowerCase()}">${kind}</span>
            <b>${esc(relDate(start))}</b> <span class="muted">${esc(fmtDate(start))}${los ? ' · LOS ' + los : ''}</span></div>
          <div class="enc-body">${esc(e.reasonCode ? window.FhirData.ccText(e.reasonCode[0]) : (e.type && window.FhirData.ccText(e.type[0])) || '')}</div>
          ${who ? '<div class="muted enc-who">' + esc(who) + '</div>' : ''}
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
        const dx = o.findings.filter(f => f.kind === 'diagnosis');
        const meds = o.findings.filter(f => f.kind === 'medication');
        const labs = o.findings.filter(f => f.kind === 'lab');
        const vits = o.findings.filter(f => f.kind === 'vital');
        const notes = o.findings.filter(f => f.kind === 'anticoag-note');
        const group = (title, items, fmt) => items.length
          ? `<div class="ocr-group"><span class="ocr-group-title">${title}</span> ${items.map(fmt).join('')}</div>` : '';
        extracted =
          group('Diagnoses', dx, f => `<span class="ocr-chip dx">${esc(f.text)}</span>`) +
          group('Meds', meds, f => `<span class="ocr-chip med">${esc(f.text)}</span>`) +
          group('Labs', labs, f => `<span class="ocr-chip lab">${esc(f.text)}${f.isNadir ? ' (nadir)' : ''}</span>`) +
          group('Vitals', vits, f => `<span class="ocr-chip">${esc(f.text)}</span>`) +
          group('Anticoagulation', notes, f => `<span class="ocr-chip warn">${esc(f.text)}</span>`) +
          `<div class="ocr-engine muted">${o.engine === 'tesseract' ? 'Extracted via OCR (Tesseract.js)' : 'OCR unavailable — simulated extraction from document text'}</div>`;
      }
      return `
        <div class="doc">
          <div class="doc-head">
            <span class="badge-outside">OUTSIDE</span>
            <b>${esc(doc.type)}</b>
          </div>
          <div class="muted">${esc(doc.custodian)}${doc.author ? ' · ' + esc(doc.author) : ''} · ${esc(fmtDate(doc.date))} (${esc(relDate(doc.date))})</div>
          <div class="doc-desc">${esc(doc.description)}</div>
          ${doc.imageDataUrl ? `<button class="doc-view" data-doc="${i}">View scanned image</button>` : ''}
          <div class="doc-extract">${extracted}</div>
        </div>`;
    }).join('');
    return card('Outside records (scanned media) <span class="sub">discrete data extracted via OCR</span>', rows);
  }

  function bindDocViewers(vm) {
    document.querySelectorAll('.doc-view').forEach(btn => {
      btn.addEventListener('click', () => {
        const doc = vm.outsideDocs[parseInt(btn.dataset.doc, 10)];
        if (!doc || !doc.imageDataUrl) return;
        const overlay = document.createElement('div');
        overlay.className = 'overlay';
        overlay.innerHTML = `<div class="overlay-inner"><img src="${doc.imageDataUrl}" alt="Scanned document"><div class="overlay-hint">Click anywhere to close</div></div>`;
        overlay.addEventListener('click', () => overlay.remove());
        document.body.appendChild(overlay);
      });
    });
  }

  function card(title, body) {
    return `<div class="card"><h3>${title}</h3>${body}</div>`;
  }

  window.addEventListener('load', init);
})();
