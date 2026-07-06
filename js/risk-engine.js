/**
 * risk-engine.js
 * Derives safety-critical flags and bedside scores from the FHIR view model.
 * Everything here is computed from FHIR-sourced data (plus OCR'd outside
 * records) — no external data sources.
 */

(function () {

  const ANTICOAGULANTS = /apixaban|eliquis|rivaroxaban|xarelto|warfarin|coumadin|dabigatran|pradaxa|edoxaban|enoxaparin|lovenox|heparin/i;
  const ANTIPLATELETS = /clopidogrel|plavix|ticagrelor|brilinta|prasugrel|effient/i;
  const IMMUNOSUPPRESSANTS = /prednisone|dexamethasone|methotrexate|tacrolimus|cyclosporine|mycophenolate|azathioprine|rituximab|adalimumab|humira|etanercept|enbrel|infliximab/i;
  const QT_PROLONGERS = /amiodarone|sotalol|dofetilide|ciprofloxacin|levofloxacin|moxifloxacin|azithromycin|haloperidol|ondansetron|methadone|quetiapine/i;
  const BETA_BLOCKERS = /metoprolol|carvedilol|atenolol|bisoprolol|propranolol|nebivolol/i;
  const INSULIN = /insulin|glargine|lantus|lispro|humalog|aspart|novolog|degludec/i;

  function latestVital(vm, loinc) {
    const hits = vm.vitals.filter(v => v.loinc === loinc && v.thisVisit);
    return hits.length ? hits[hits.length - 1] : null;
  }

  function firstVital(vm, loinc) {
    return vm.vitals.find(v => v.loinc === loinc && v.thisVisit) || null;
  }

  function latestLab(vm, loinc) {
    return vm.labsCurrent.find(l => l.loinc === loinc && typeof l.value === 'number') || null;
  }

  function bpComponents(bpObs) {
    if (!bpObs) return { sbp: null, dbp: null };
    const sbp = (bpObs.components.find(c => /systolic/i.test(c.label)) || {}).value;
    const dbp = (bpObs.components.find(c => /diastolic/i.test(c.label)) || {}).value;
    return { sbp, dbp };
  }

  /** All meds: EHR meds + OCR-extracted outside meds. */
  function allMedTexts(vm) {
    const outside = (vm.outsideMeds || []).map(m => m.text + ' ' + (m.dose || ''));
    return vm.meds.map(m => m.text + ' ' + m.dose).concat(outside);
  }

  function medHit(vm, regex) {
    const ehr = vm.meds.find(m => regex.test(m.text));
    if (ehr) return { text: ehr.text, source: 'ehr' };
    const out = (vm.outsideMeds || []).find(m => regex.test(m.text));
    if (out) return { text: out.text, source: 'outside' };
    return null;
  }

  /* ------------------------------------------------------------- scores */

  function computeScores(vm) {
    const triageBP = firstVital(vm, '85354-9');
    const { sbp } = bpComponents(triageBP);
    const rr = firstVital(vm, '9279-1');
    const gcs = firstVital(vm, '9269-2');
    const temp = firstVital(vm, '8310-5');
    const hr = firstVital(vm, '8867-4');
    const spo2 = firstVital(vm, '59408-5');
    const scores = [];

    /* qSOFA */
    if (sbp != null || rr || gcs) {
      let q = 0; const parts = [];
      if (sbp != null && sbp <= 100) { q++; parts.push('SBP ' + sbp + ' ≤100'); }
      if (rr && rr.value >= 22) { q++; parts.push('RR ' + rr.value + ' ≥22'); }
      if (gcs && gcs.value < 15) { q++; parts.push('GCS ' + gcs.value + ' <15'); }
      scores.push({ name: 'qSOFA', value: q + ' / 3', danger: q >= 2, detail: parts.join(' · ') || 'no criteria met' });
    }

    /* SIRS */
    const wbc = latestLab(vm, '6690-2');
    let s = 0; const sparts = [];
    if (temp && (temp.value > 38 || temp.value < 36)) { s++; sparts.push('T ' + temp.value + '°C'); }
    if (hr && hr.value > 90) { s++; sparts.push('HR ' + hr.value); }
    if (rr && rr.value > 20) { s++; sparts.push('RR ' + rr.value); }
    if (wbc && (wbc.value > 12 || wbc.value < 4)) { s++; sparts.push('WBC ' + wbc.value); }
    if (sparts.length) scores.push({ name: 'SIRS', value: s + ' / 4', danger: s >= 2, detail: sparts.join(' · ') });

    /* NEWS2 (partial — from available triage data) */
    if (rr && spo2 && temp && hr && sbp != null) {
      let n = 0;
      const rv = rr.value; n += rv >= 25 ? 3 : rv >= 21 ? 2 : rv >= 12 ? 0 : rv >= 9 ? 1 : 3;
      const ov = spo2.value; n += ov <= 91 ? 3 : ov <= 93 ? 2 : ov <= 95 ? 1 : 0;
      if (/nasal cannula|[0-9] ?L|oxygen|O2/i.test(spo2.note || '')) n += 2;
      n += sbp <= 90 ? 3 : sbp <= 100 ? 2 : sbp <= 110 ? 1 : sbp >= 220 ? 3 : 0;
      const hv = hr.value; n += hv >= 131 ? 3 : hv >= 111 ? 2 : hv >= 91 ? 1 : hv >= 51 ? 0 : hv >= 41 ? 1 : 3;
      const tv = temp.value; n += tv >= 39.1 ? 2 : tv >= 38.1 ? 1 : tv >= 36.1 ? 0 : tv >= 35.1 ? 1 : 3;
      if (gcs && gcs.value < 15) n += 3;
      scores.push({ name: 'NEWS2', value: String(n), danger: n >= 7, detail: n >= 7 ? 'high risk — urgent response threshold' : n >= 5 ? 'medium risk' : 'low risk' });
    }

    /* Shock index */
    if (hr && sbp != null) {
      const si = (hr.value / sbp);
      scores.push({ name: 'Shock index', value: si.toFixed(2), danger: si >= 1.0, detail: 'HR ' + hr.value + ' / SBP ' + sbp + (si >= 1.0 ? ' — elevated' : '') });
    }

    /* Anion gap */
    const na = latestLab(vm, '2951-2'), cl = latestLab(vm, '2075-0'), co2 = latestLab(vm, '2028-9');
    if (na && cl && co2) {
      const ag = na.value - cl.value - co2.value;
      scores.push({ name: 'Anion gap', value: String(ag), danger: ag > 14, detail: ag > 14 ? 'elevated — consider lactate, ketones, toxins' : 'normal' });
    }

    return scores;
  }

  /* -------------------------------------------------------------- flags */

  function computeFlags(vm) {
    const flags = [];
    const add = (level, label, detail, source) =>
      flags.push({ level, label, detail: detail || '', source: source || 'ehr' }); // level: critical | warning

    /* Anticoagulation */
    const ac = medHit(vm, ANTICOAGULANTS);
    if (ac) {
      const bleedHx = (vm.outsideFindings || []).some(f => /bleed|hemorrhage|melena/i.test(f.text))
        || vm.conditions.some(c => /bleed|hemorrhage/i.test(c.text));
      add('critical', 'ANTICOAGULATED', ac.text + (bleedHx ? ' — WITH RECENT GI BLEED HISTORY' : ''), ac.source);
    }
    const ap = medHit(vm, ANTIPLATELETS);
    if (ap) add('warning', 'Antiplatelet therapy', ap.text, ap.source);

    /* Recent major bleed from outside records */
    (vm.outsideFindings || []).filter(f => f.kind === 'diagnosis' && /bleed|hemorrhage/i.test(f.text)).forEach(f => {
      add('critical', 'RECENT GI BLEED', f.text + ' (' + f.docLabel + ')', 'outside');
    });

    /* Severe allergies */
    vm.allergies.filter(a => a.criticality === 'high' || a.severity === 'severe').forEach(a => {
      add('critical', 'ALLERGY: ' + a.text.toUpperCase(), a.reaction || 'high criticality', 'ehr');
    });

    /* Sepsis physiology */
    const lact = vm.labsCurrent.find(l => l.loinc === '2524-7' && typeof l.value === 'number');
    if (lact && lact.value >= 4) add('critical', 'LACTATE ' + lact.value, 'severe elevation — septic shock threshold');
    else if (lact && lact.value >= 2) add('warning', 'Lactate ' + lact.value, 'elevated');

    /* Hyperkalemia */
    const k = vm.labsCurrent.find(l => l.loinc === '2823-3' && typeof l.value === 'number');
    if (k && k.value >= 6.0) add('critical', 'HYPERKALEMIA K ' + k.value, 'obtain ECG, treat emergently');
    else if (k && k.value >= 5.5) add('warning', 'Hyperkalemia K ' + k.value, 'recheck; review ECG for peaked T waves');

    /* AKI vs baseline creatinine */
    const crNow = vm.labsCurrent.find(l => l.loinc === '2160-0' && typeof l.value === 'number');
    const crPrior = vm.priorByLoinc['2160-0'];
    if (crNow && crPrior && crNow.value >= crPrior.value * 1.5 - 1e-9) {
      add('warning', 'Acute kidney injury', 'Cr ' + crNow.value + ' from baseline ' + crPrior.value + ' (' + window.FhirData.relDate(crPrior.effective) + ') — dose-adjust and avoid nephrotoxins');
    }

    /* Acute hemoglobin drop */
    const hgbNow = vm.labsCurrent.find(l => l.loinc === '718-7' && typeof l.value === 'number');
    const hgbPrior = vm.priorByLoinc['718-7'];
    if (hgbNow && hgbPrior && hgbPrior.value - hgbNow.value >= 2) {
      add('critical', 'HGB DROP ' + hgbPrior.value + ' → ' + hgbNow.value, 'vs ' + window.FhirData.relDate(hgbPrior.effective) + (ac ? ' while anticoagulated — evaluate for bleeding' : ''));
    }

    /* QT risk: prolonged QTc on ECG + QT-prolonging meds */
    const ecg = vm.reports.find(r => r.kind === 'ecg' && r.thisVisit);
    const qtcMatch = ecg && ecg.conclusion.match(/QTc\s*(\d{3})/i);
    const qtMeds = allMedTexts(vm).filter(t => QT_PROLONGERS.test(t));
    if (qtcMatch && parseInt(qtcMatch[1], 10) >= 470 && qtMeds.length) {
      add('warning', 'QTc ' + qtcMatch[1] + ' ms + QT-prolonging meds', qtMeds.map(t => t.split(' ')[0]).join(', ') + ' — avoid additional QT agents');
    }

    /* Immunosuppression */
    const im = medHit(vm, IMMUNOSUPPRESSANTS);
    if (im) add('warning', 'Immunosuppressed', im.text, im.source);

    /* Beta blockade masking tachycardia */
    if (medHit(vm, BETA_BLOCKERS)) add('warning', 'Beta-blocked', 'HR response to shock/sepsis may be blunted');

    /* Insulin (hypoglycemia risk if NPO) */
    if (medHit(vm, INSULIN)) add('warning', 'On insulin', 'hypoglycemia risk while NPO');

    /* Implanted devices */
    vm.devices.forEach(d => add('warning', d.text.replace(/\s*\(.*\)$/, ''), d.detail, 'ehr'));

    /* Contrast allergy + renal function interplay */
    if (vm.allergies.some(a => /contrast/i.test(a.text)) && crNow && crNow.value > 1.5) {
      add('warning', 'Contrast: allergy + AKI', 'premedication AND nephrotoxicity considerations for CT with contrast');
    }

    const order = { critical: 0, warning: 1 };
    flags.sort((a, b) => order[a.level] - order[b.level]);
    return flags;
  }

  window.RiskEngine = { computeScores, computeFlags, bpComponents };
})();
