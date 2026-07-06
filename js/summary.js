/**
 * summary.js
 * Generates the prose "at a glance" narrative at the top of the page.
 * Every statement is assembled from FHIR-sourced values on the view model
 * (or OCR of FHIR DocumentReference attachments) — nothing is free-typed.
 */

(function () {
  const { relDate, fmtTime } = window.FhirData;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function firstVital(vm, loinc) {
    return vm.vitals.find(v => v.loinc === loinc && v.thisVisit) || null;
  }

  function lastVital(vm, loinc) {
    const hits = vm.vitals.filter(v => v.loinc === loinc && v.thisVisit);
    return hits.length ? hits[hits.length - 1] : null;
  }

  function labNow(vm, loinc) {
    return vm.labsCurrent.find(l => l.loinc === loinc && typeof l.value === 'number') || null;
  }

  /** Shorten a problem-list entry for prose: drop parentheticals except EF. */
  function shortProblem(text) {
    return proseCase(text.replace(/\s*\((?!EF)[^)]*\)/g, '').trim());
  }

  /** Lowercase for mid-sentence use, preserving acronyms (COPD, GI, HFrEF…). */
  function proseCase(s) {
    return s.split(' ').map(w => /^[A-Z][a-z]/.test(w) ? w.charAt(0).toLowerCase() + w.slice(1) : w).join(' ');
  }

  function joinAnd(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + (items.length > 2 ? ',' : '') + ' and ' + items[items.length - 1];
  }

  function generateSummary(vm, flags, scores) {
    const paras = [];

    /* Who + why here */
    let s1 = '';
    const p = vm.patient;
    if (p.age != null) s1 += `<b>${p.age}-year-old ${esc(p.gender)}</b>`;
    else s1 += `<b>${esc(p.name)}</b>`;
    const probs = vm.conditions.map(c => shortProblem(c.text));
    if (probs.length) {
      const shown = probs.slice(0, 6);
      s1 += ' with ' + esc(joinAnd(shown)) + (probs.length > 6 ? ` (+${probs.length - 6} more)` : '');
    }
    const enc = vm.currentEncounter;
    if (enc) {
      const reason = enc.reasonCode && window.FhirData.ccText(enc.reasonCode[0]);
      s1 += `, presenting ${reason ? 'with <b>' + esc(proseCase(reason.replace(/\s*\([^)]*\)$/, ''))) + '</b>' : 'to the ED'}`;
      if (enc.period && enc.period.start) s1 += `, arrived ${esc(fmtTime(enc.period.start))}`;
    }
    paras.push(s1 + '.');

    /* Triage physiology + scores */
    const bits = [];
    const t = firstVital(vm, '8310-5');
    if (t) bits.push('T ' + t.value + '°C');
    const hr = firstVital(vm, '8867-4');
    if (hr) bits.push('HR ' + hr.value + (/irregular/i.test(hr.note || '') ? ' (irregular)' : ''));
    const bp = firstVital(vm, '85354-9');
    if (bp) {
      const { sbp, dbp } = window.RiskEngine.bpComponents(bp);
      if (sbp != null) bits.push('BP ' + sbp + '/' + dbp);
    }
    const rr = firstVital(vm, '9279-1');
    if (rr) bits.push('RR ' + rr.value);
    const spo2 = firstVital(vm, '59408-5');
    if (spo2) bits.push('SpO2 ' + spo2.value + '%' + (/room air/i.test(spo2.note || '') ? ' RA' : /L\b|oxygen|cannula/i.test(spo2.note || '') ? ' (' + spo2.note.replace(/^On /i, '') + ')' : ''));
    const gcs = firstVital(vm, '9269-2');
    if (gcs && gcs.value < 15) bits.push('GCS ' + gcs.value);
    if (bits.length) {
      let s2 = 'Triage: ' + esc(bits.join(', ')) + '.';
      const hot = scores.filter(sc => sc.danger).map(sc => sc.name + ' ' + sc.value.replace(/\s/g, ''));
      if (hot.length) s2 += ' <b>' + esc(hot.join(', ')) + '</b>.';
      const bpLast = lastVital(vm, '85354-9');
      if (bp && bpLast && bpLast !== bp) {
        const a = window.RiskEngine.bpComponents(bp), b = window.RiskEngine.bpComponents(bpLast);
        if (a.sbp != null && b.sbp != null) s2 += ` BP ${esc(a.sbp + '/' + a.dbp)} → ${esc(b.sbp + '/' + b.dbp)} after initial treatment.`;
      }
      paras.push(s2);
    }

    /* Notable labs so far (ordered by clinical urgency) */
    const labOrder = [
      ['2524-7', 'lactate'], ['2160-0', 'Cr'], ['718-7', 'Hgb'], ['2823-3', 'K'],
      ['6690-2', 'WBC'], ['89579-7', 'hs-troponin'], ['30934-4', 'BNP'], ['2345-7', 'glucose'], ['2951-2', 'Na']
    ];
    const labBits = [];
    labOrder.forEach(([loinc, label]) => {
      const l = labNow(vm, loinc);
      if (!l || !['H', 'L', 'HH', 'LL', 'A'].includes(l.interp)) return;
      let bit = label + ' ' + l.value;
      const prior = vm.priorByLoinc[loinc];
      if (prior && typeof prior.value === 'number' && Math.abs(l.value - prior.value) / Math.max(Math.abs(prior.value), 0.01) >= 0.2) {
        bit += ' (from ' + prior.value + ' ' + relDate(prior.effective) + (prior.source === 'outside' ? ', outside record' : '') + ')';
      }
      labBits.push(bit);
    });
    if (labBits.length) paras.push('Labs notable for ' + esc(joinAnd(labBits.slice(0, 6))) + '.');

    /* Safety concerns from computed flags */
    const crit = flags.filter(f => f.level === 'critical');
    if (crit.length) {
      const items = crit.map(f => {
        let txt = proseCase(f.label);
        if (/^allergy: /i.test(f.label)) txt = proseCase(f.label.replace(/^Allergy: /i, '')) + ' allergy' + (f.detail ? ' (' + proseCase(f.detail) + ')' : '');
        else if (/^anticoagulated/i.test(f.label)) txt = 'anticoagulated (' + proseCase(f.detail.split('—')[0].replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()) + ')';
        if (f.source === 'outside') txt += ' — per outside records';
        return txt;
      });
      paras.push('<b>Safety:</b> ' + esc(joinAnd(items)) + '.');
    }

    /* Recent care trajectory */
    const encs = vm.pastEncounters.filter(e => e.period && e.period.start &&
      (new Date() - new Date(e.period.start)) < 120 * 86400000);
    const careBits = [];
    encs.slice(0, 3).forEach(e => {
      const cls = e.class && e.class.code;
      const kind = cls === 'IMP' ? 'hospitalized' : cls === 'EMER' ? 'ED visit' : 'clinic visit';
      const reason = (e.reasonCode && window.FhirData.ccText(e.reasonCode[0])) || '';
      careBits.push(kind + ' ' + relDate(e.period.start) + (reason ? ' (' + proseCase(reason.split(/[;—]/)[0].trim()) + ')' : ''));
    });
    (vm.outsideDocs || []).slice(0, 2).forEach(d => {
      careBits.push('outside records from ' + (d.custodian || 'another facility') + ' ' + relDate(d.date));
    });
    if (careBits.length) paras.push('Recent care: ' + esc(joinAnd(careBits)) + '.');

    return paras.map(x => '<p>' + x + '</p>').join('');
  }

  window.Summary = { generateSummary };
})();
