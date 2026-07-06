/**
 * fhir-data.js
 * FHIR R4 data access + normalization layer.
 *
 * Two entry points:
 *   - fetchLiveResources(client): pulls resources from a live SMART on FHIR
 *     server (Epic-compatible queries only).
 *   - buildViewModel(resources): normalizes a flat array of FHIR resources
 *     into the view model rendered by app.js.
 *
 * Demo mode feeds window.DEMO_BUNDLE through buildViewModel(); live mode feeds
 * the fetched resources through the identical code path.
 */

/* ------------------------------------------------------------ small utils */

/* Parse FHIR dates; date-only strings are treated as local noon so they don't
   shift a day when displayed in western timezones. */
function parseFhirDate(s) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + 'T12:00:00');
  return new Date(s);
}

function ccText(cc) {
  if (!cc) return '';
  return cc.text || (cc.coding && cc.coding[0] && (cc.coding[0].display || cc.coding[0].code)) || '';
}

function loincOf(obs) {
  const c = (obs.code && obs.code.coding) || [];
  const hit = c.find(x => x.system === 'http://loinc.org');
  return hit ? hit.code : (c[0] && c[0].code) || '';
}

const UNIT_DISPLAY = { 'Cel': '°C', 'mm[Hg]': 'mmHg', '10*3/uL': 'K/µL' };

function obsValue(obs) {
  if (obs.valueQuantity) {
    let unit = obs.valueQuantity.unit || '';
    unit = UNIT_DISPLAY[unit] || unit;
    return { value: obs.valueQuantity.value, unit, display: obs.valueQuantity.value + (unit && unit !== '{score}' && unit !== '{INR}' ? ' ' + unit : '') };
  }
  if (obs.valueString) return { value: obs.valueString, unit: '', display: obs.valueString };
  if (obs.valueCodeableConcept) return { value: ccText(obs.valueCodeableConcept), unit: '', display: ccText(obs.valueCodeableConcept) };
  return { value: null, unit: '', display: '—' };
}

function obsInterp(obs) {
  const i = obs.interpretation && obs.interpretation[0];
  if (!i) return '';
  const code = (i.coding && i.coding[0] && i.coding[0].code) || i.text || '';
  return code; // H, L, HH, LL, A, N
}

function obsRefRange(obs) {
  const r = obs.referenceRange && obs.referenceRange[0];
  if (!r) return '';
  if (r.text) return r.text;
  const lo = r.low ? r.low.value : null;
  const hi = r.high ? r.high.value : null;
  if (lo != null && hi != null) return lo + '–' + hi;
  if (hi != null) return '<' + hi;
  if (lo != null) return '>' + lo;
  return '';
}

function noteText(res) {
  return (res.note && res.note[0] && res.note[0].text) || '';
}

function fmtDate(s) {
  if (!s) return '';
  const d = parseFhirDate(s);
  if (isNaN(d)) return s;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

function relDate(s) {
  if (!s) return '';
  const d = parseFhirDate(s);
  const days = daysBetween(d, new Date());
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return days + ' d ago';
  if (days < 365) return Math.round(days / 30.4) + ' mo ago';
  return (days / 365).toFixed(1) + ' yr ago';
}

function ageFromDob(dob) {
  const b = parseFhirDate(dob);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

/* ----------------------------------------------------------- live fetching */

/**
 * Query set is limited to resources/searches supported by Epic's R4 API
 * (see README for the Epic sandbox notes). Failures on individual queries are
 * tolerated so a partially-scoped app registration still renders.
 */
async function fetchLiveResources(client) {
  const pid = client.patient.id;
  const q = (url) => client.request(url, { pageLimit: 0, flat: true }).catch(err => {
    console.warn('FHIR query failed:', url, err);
    return [];
  });

  const results = await Promise.all([
    client.patient.read(),
    q(`Encounter?patient=${pid}&_sort=-date&_count=50`),
    q(`Condition?patient=${pid}&category=problem-list-item`),
    q(`MedicationRequest?patient=${pid}&status=active,on-hold,stopped&_count=100`),
    q(`AllergyIntolerance?patient=${pid}`),
    q(`Observation?patient=${pid}&category=vital-signs&_sort=-date&_count=100`),
    q(`Observation?patient=${pid}&category=laboratory&_sort=-date&_count=200`),
    q(`DiagnosticReport?patient=${pid}&_sort=-date&_count=50`),
    q(`DocumentReference?patient=${pid}&_count=50`),
    q(`Device?patient=${pid}`)
  ]);

  const [patient, ...rest] = results;
  return [patient].concat(...rest.map(r => Array.isArray(r) ? r : [r]));
}

/* ------------------------------------------------------------- view model */

function buildViewModel(resources) {
  const byType = {};
  resources.filter(Boolean).forEach(r => {
    (byType[r.resourceType] = byType[r.resourceType] || []).push(r);
  });

  const patientRes = (byType.Patient || [])[0] || {};
  const name = patientRes.name && patientRes.name[0];
  const mrnId = (patientRes.identifier || []).find(i => (i.type && /mrn/i.test(ccText(i.type))));

  const patient = {
    name: name ? [(name.given || []).join(' '), name.family].join(' ').trim() : 'Unknown Patient',
    dob: patientRes.birthDate || '',
    age: patientRes.birthDate ? ageFromDob(patientRes.birthDate) : null,
    gender: patientRes.gender || '',
    mrn: mrnId ? mrnId.value : ((patientRes.identifier || [])[0] || {}).value || ''
  };

  /* Encounters: current = in-progress emergency (or most recent in-progress) */
  const encounters = (byType.Encounter || []).slice().sort((a, b) =>
    new Date((b.period && b.period.start) || 0) - new Date((a.period && a.period.start) || 0));
  const currentEncounter = encounters.find(e => e.status === 'in-progress' && e.class && e.class.code === 'EMER')
    || encounters.find(e => e.status === 'in-progress') || null;
  const currentEncId = currentEncounter ? currentEncounter.id : null;
  const pastEncounters = encounters.filter(e => e !== currentEncounter);

  const inCurrentEnc = (res) => {
    if (!currentEncId) return false;
    const ref = res.encounter && res.encounter.reference;
    return ref === 'Encounter/' + currentEncId;
  };

  /* Conditions */
  const conditions = (byType.Condition || [])
    .filter(c => {
      const s = c.clinicalStatus && c.clinicalStatus.coding && c.clinicalStatus.coding[0];
      return !s || ['active', 'recurrence', 'relapse'].includes(s.code);
    })
    .map(c => ({
      text: ccText(c.code),
      onset: c.onsetDateTime || c.recordedDate || '',
      note: noteText(c),
      source: 'ehr'
    }));

  /* Medications: active orders, plus dose-change detection against prior
     stopped/completed orders for the same drug (how Epic represents a dose
     change — the old order is discontinued and a new one is authored). */
  const allMedReqs = byType.MedicationRequest || [];
  const medName = m => ccText(m.medicationCodeableConcept) || (m.medicationReference && m.medicationReference.display) || 'Medication';
  const medDose = m => (m.dosageInstruction && m.dosageInstruction[0] && m.dosageInstruction[0].text) || '';
  const drugKey = text => text.split(/[\s(]/)[0].toLowerCase();

  const stoppedMeds = allMedReqs.filter(m => ['stopped', 'completed', 'cancelled'].includes(m.status));
  const meds = allMedReqs
    .filter(m => ['active', 'on-hold'].includes(m.status))
    .map(m => {
      const text = medName(m);
      const dose = medDose(m);
      const prior = stoppedMeds.find(p => drugKey(medName(p)) === drugKey(text) && medDose(p) && medDose(p) !== dose);
      return {
        text,
        dose,
        authoredOn: m.authoredOn || '',
        status: m.status,
        requester: (m.requester && m.requester.display) || '',
        note: noteText(m),
        priorDose: prior ? medDose(prior) : '',
        recentChange: m.authoredOn ? daysBetween(new Date(m.authoredOn), new Date()) <= 30 : false,
        source: 'ehr'
      };
    })
    .sort((a, b) => new Date(b.authoredOn || 0) - new Date(a.authoredOn || 0));

  /* Allergies */
  const allergies = (byType.AllergyIntolerance || []).map(a => ({
    text: ccText(a.code),
    criticality: a.criticality || '',
    reaction: (a.reaction && a.reaction[0] && a.reaction[0].manifestation && ccText(a.reaction[0].manifestation[0])) || '',
    severity: (a.reaction && a.reaction[0] && a.reaction[0].severity) || ''
  }));

  /* Devices */
  const devices = (byType.Device || []).map(d => ({
    text: ccText(d.type),
    detail: [(d.manufacturer || ''), (d.deviceName && d.deviceName[0] && d.deviceName[0].name) || ''].filter(Boolean).join(' '),
    note: noteText(d)
  }));

  /* Observations */
  const allObs = byType.Observation || [];
  const vitalsAll = allObs.filter(o => (o.category || []).some(c => ccText(c) === 'Vital Signs' || (c.coding || []).some(x => x.code === 'vital-signs')));
  const labsAll = allObs.filter(o => (o.category || []).some(c => (c.coding || []).some(x => x.code === 'laboratory')));

  const normObs = (o) => ({
    id: o.id,
    loinc: loincOf(o),
    label: ccText(o.code),
    ...obsValue(o),
    interp: obsInterp(o),
    ref: obsRefRange(o),
    effective: o.effectiveDateTime || o.issued || '',
    note: noteText(o),
    status: o.status,
    components: (o.component || []).map(c => ({
      label: ccText(c.code),
      value: c.valueQuantity ? c.valueQuantity.value : null,
      unit: c.valueQuantity ? c.valueQuantity.unit : ''
    })),
    thisVisit: inCurrentEnc(o),
    source: 'ehr'
  });

  const vitals = vitalsAll.map(normObs).sort((a, b) => new Date(a.effective) - new Date(b.effective));
  const labs = labsAll.map(normObs).sort((a, b) => new Date(b.effective) - new Date(a.effective));
  const labsCurrent = labs.filter(l => l.thisVisit);
  const labsHistorical = labs.filter(l => !l.thisVisit);

  /* Prior value lookup for delta display, keyed by LOINC */
  const priorByLoinc = {};
  labsHistorical.forEach(l => {
    if (typeof l.value === 'number' && !priorByLoinc[l.loinc]) priorByLoinc[l.loinc] = l;
  });

  /* Diagnostic reports */
  const reports = (byType.DiagnosticReport || []).map(r => {
    const cat = ccText((r.category || [])[0]).toLowerCase();
    let kind = 'other';
    if (/electrocardiog|^ec$|ekg|ecg/.test(cat) || /ecg|ekg/i.test(ccText(r.code))) kind = 'ecg';
    else if (/rad|imag|x-ray|ct |ultraso/i.test(cat + ' ' + ccText(r.code))) kind = 'imaging';
    else if (/cardiac ultrasound|echo/i.test(cat + ' ' + ccText(r.code))) kind = 'echo';
    return {
      kind,
      label: ccText(r.code),
      conclusion: r.conclusion || (r.presentedForm && r.presentedForm[0] && r.presentedForm[0].title) || '',
      effective: r.effectiveDateTime || r.issued || '',
      status: r.status,
      thisVisit: inCurrentEnc(r)
    };
  }).sort((a, b) => new Date(b.effective) - new Date(a.effective));

  /* Scanned outside documents */
  const outsideDocs = (byType.DocumentReference || [])
    .filter(d => {
      const cat = (d.category || []).map(ccText).join(' ');
      const ct = d.content && d.content[0] && d.content[0].attachment && d.content[0].attachment.contentType;
      // Outside/scanned media: explicitly categorized, or image/PDF attachments
      return /outside|scan|media/i.test(cat + ' ' + (d.description || '')) || /^image\/|pdf$/.test(ct || '');
    })
    .map(d => ({
      id: d.id,
      type: ccText(d.type),
      date: d.date || '',
      author: (d.author && d.author[0] && d.author[0].display) || '',
      custodian: (d.custodian && d.custodian.display) || '',
      description: d.description || '',
      attachment: (d.content && d.content[0] && d.content[0].attachment) || null,
      ocr: null // filled in by ocr.js
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    patient, currentEncounter, pastEncounters, conditions, meds, allergies,
    devices, vitals, labsCurrent, labsHistorical, priorByLoinc, reports, outsideDocs
  };
}

window.FhirData = { fetchLiveResources, buildViewModel, fmtDate, fmtTime, relDate, ccText };
