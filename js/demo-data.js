/**
 * demo-data.js
 * Simulated FHIR R4 Bundle for demo patient "John Dorian".
 *
 * Every resource type used here (Patient, Encounter, Condition, MedicationRequest,
 * AllergyIntolerance, Observation, DiagnosticReport, DocumentReference, Device)
 * is available from Epic's R4 FHIR API, so this bundle doubles as a data contract
 * for sandbox testing: the app consumes this bundle through the exact same
 * extraction pipeline it uses for live SMART on FHIR queries.
 *
 * Clinical picture: 72M with AFib on apixaban, HFrEF (EF 30%, ICD in situ),
 * CKD 3b, T2DM, COPD, CAD s/p DES, and a recent major GI bleed managed at an
 * OUTSIDE hospital (known only via scanned records). Presents today in probable
 * septic shock (urosepsis) with AKI, worsening anemia, and AFib with RVR.
 */

/* Current ED encounter timeline is anchored to "today" so the demo always looks live. */
const NOW = new Date();
function iso(d) { return d.toISOString(); }
function todayAt(h, m) {
  const d = new Date(NOW);
  d.setHours(h, m, 0, 0);
  return iso(d);
}
function daysAgo(n, h = 10, m = 0) {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  d.setHours(h, m, 0, 0);
  return iso(d);
}
function dateDaysAgo(n) { return daysAgo(n).slice(0, 10); }

const PATIENT_REF = { reference: 'Patient/demo-jd-1' };
const CURRENT_ED_REF = { reference: 'Encounter/enc-ed-current' };

function vital(id, loinc, display, value, unit, effective, opts = {}) {
  return {
    resourceType: 'Observation',
    id,
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs', display: 'Vital Signs' }] }],
    code: { coding: [{ system: 'http://loinc.org', code: loinc, display }], text: display },
    subject: PATIENT_REF,
    encounter: opts.encounter || CURRENT_ED_REF,
    effectiveDateTime: effective,
    valueQuantity: { value, unit, system: 'http://unitsofmeasure.org', code: unit },
    ...(opts.interpretation ? { interpretation: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: opts.interpretation }] }] } : {}),
    ...(opts.note ? { note: [{ text: opts.note }] } : {})
  };
}

function lab(id, loinc, display, value, unit, effective, opts = {}) {
  const o = {
    resourceType: 'Observation',
    id,
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory', display: 'Laboratory' }] }],
    code: { coding: [{ system: 'http://loinc.org', code: loinc, display }], text: display },
    subject: PATIENT_REF,
    effectiveDateTime: effective,
    ...(opts.encounter ? { encounter: opts.encounter } : {}),
    ...(opts.interpretation ? { interpretation: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: opts.interpretation }] }] } : {}),
    ...(opts.refLow != null || opts.refHigh != null ? {
      referenceRange: [{
        ...(opts.refLow != null ? { low: { value: opts.refLow, unit } } : {}),
        ...(opts.refHigh != null ? { high: { value: opts.refHigh, unit } } : {}),
        ...(opts.refText ? { text: opts.refText } : {})
      }]
    } : {})
  };
  if (typeof value === 'string') {
    o.valueString = value;
  } else {
    o.valueQuantity = { value, unit, system: 'http://unitsofmeasure.org', code: unit };
  }
  return o;
}

function medRequest(id, text, dose, authoredOn, opts = {}) {
  return {
    resourceType: 'MedicationRequest',
    id,
    status: opts.status || 'active',
    intent: 'order',
    medicationCodeableConcept: {
      ...(opts.rxnorm ? { coding: [{ system: 'http://www.nlm.nih.gov/research/umls/rxnorm', code: opts.rxnorm, display: text }] } : {}),
      text
    },
    subject: PATIENT_REF,
    authoredOn,
    ...(opts.requester ? { requester: { display: opts.requester } } : {}),
    dosageInstruction: [{ text: dose }],
    ...(opts.note ? { note: [{ text: opts.note }] } : {})
  };
}

function condition(id, snomed, text, onset, opts = {}) {
  return {
    resourceType: 'Condition',
    id,
    clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: opts.clinical || 'active' }] },
    verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: 'confirmed' }] },
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'problem-list-item' }] }],
    code: { coding: [{ system: 'http://snomed.info/sct', code: snomed, display: text }], text },
    subject: PATIENT_REF,
    onsetDateTime: onset,
    ...(opts.note ? { note: [{ text: opts.note }] } : {})
  };
}

const DEMO_RESOURCES = [

  /* ---------------------------------------------------------------- Patient */
  {
    resourceType: 'Patient',
    id: 'demo-jd-1',
    identifier: [{ type: { text: 'MRN' }, system: 'urn:oid:1.2.840.114350.1.13.0.1.7.5.737384.0', value: 'E4738291' }],
    name: [{ use: 'official', family: 'Dorian', given: ['John', 'Michael'] }],
    gender: 'male',
    birthDate: '1954-03-15',
    telecom: [{ system: 'phone', value: '555-014-7823', use: 'home' }],
    address: [{ line: ['1478 Elliot Way'], city: 'San DiFrangeles', state: 'CA', postalCode: '90210' }]
  },

  /* ------------------------------------------------------------ Encounters */
  {
    resourceType: 'Encounter',
    id: 'enc-ed-current',
    status: 'in-progress',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'EMER', display: 'emergency' },
    type: [{ text: 'Emergency Department Visit' }],
    subject: PATIENT_REF,
    period: { start: todayAt(14, 32) },
    reasonCode: [{ text: 'Fever, confusion, hypotension (EMS arrival)' }],
    location: [{ location: { display: 'ED Room 12' } }],
    serviceProvider: { display: 'University Medical Center' }
  },
  {
    resourceType: 'Encounter',
    id: 'enc-ed-chf',
    status: 'finished',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'EMER', display: 'emergency' },
    type: [{ text: 'Emergency Department Visit' }],
    subject: PATIENT_REF,
    period: { start: daysAgo(22, 19, 4), end: daysAgo(22, 23, 55) },
    reasonCode: [{ text: 'Acute heart failure exacerbation' }],
    serviceProvider: { display: 'University Medical Center' }
  },
  {
    resourceType: 'Encounter',
    id: 'enc-pcp',
    status: 'finished',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
    type: [{ text: 'Office Visit — Primary Care' }],
    subject: PATIENT_REF,
    period: { start: daysAgo(8, 9, 30), end: daysAgo(8, 10, 10) },
    reasonCode: [{ text: 'Post-ED follow-up' }],
    participant: [{ individual: { display: 'Elliot Reid, MD (Primary Care)' } }],
    serviceProvider: { display: 'University Medical Center — Internal Medicine Clinic' }
  },
  {
    resourceType: 'Encounter',
    id: 'enc-cards',
    status: 'finished',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
    type: [{ text: 'Office Visit — Cardiology' }],
    subject: PATIENT_REF,
    period: { start: daysAgo(16, 13, 0), end: daysAgo(16, 13, 40) },
    reasonCode: [{ text: 'HFrEF / AFib management' }],
    participant: [{ individual: { display: 'Kim Briggs, MD (Cardiology)' } }],
    serviceProvider: { display: 'University Medical Center — Cardiology Clinic' }
  },
  {
    resourceType: 'Encounter',
    id: 'enc-inpt-chf',
    status: 'finished',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IMP', display: 'inpatient encounter' },
    type: [{ text: 'Inpatient Admission' }],
    subject: PATIENT_REF,
    period: { start: daysAgo(94, 8, 0), end: daysAgo(90, 11, 0) },
    reasonCode: [{ text: 'Acute on chronic heart failure exacerbation' }],
    serviceProvider: { display: 'University Medical Center' }
  },

  /* ------------------------------------------------------------- Conditions */
  condition('cond-afib', '49436004', 'Atrial fibrillation', '2019-08-01'),
  condition('cond-hfref', '703272007', 'Heart failure with reduced ejection fraction (EF 30%)', '2021-02-01'),
  condition('cond-cad', '53741008', 'Coronary artery disease s/p DES to LAD (2023)', '2023-05-01'),
  condition('cond-ckd', '700379002', 'Chronic kidney disease stage 3B', '2022-01-01'),
  condition('cond-dm', '44054006', 'Type 2 diabetes mellitus with peripheral neuropathy', '2012-01-01'),
  condition('cond-copd', '13645005', 'Chronic obstructive pulmonary disease (GOLD II)', '2015-01-01'),
  condition('cond-htn', '38341003', 'Essential hypertension', '2008-01-01'),

  /* ------------------------------------------------------------ Medications */
  /* Dose changes are represented the way Epic exposes them: the prior order
     appears as a separate MedicationRequest with status "stopped"; the UI
     derives "previously …" by comparing same-drug orders. */
  medRequest('med-apixaban', 'Apixaban (Eliquis) 2.5 mg tablet', '2.5 mg PO twice daily', dateDaysAgo(8), {
    rxnorm: '1364445',
    requester: 'Elliot Reid, MD'
  }),
  medRequest('med-apixaban-old', 'Apixaban (Eliquis) 5 mg tablet', '5 mg PO twice daily', '2024-02-12', {
    rxnorm: '1364447',
    status: 'stopped'
  }),
  medRequest('med-metoprolol', 'Metoprolol succinate ER 100 mg tablet', '100 mg PO daily', '2024-11-02', { rxnorm: '866414' }),
  medRequest('med-furosemide', 'Furosemide 80 mg tablet', '80 mg PO twice daily', dateDaysAgo(8), {
    rxnorm: '313988',
    requester: 'Elliot Reid, MD'
  }),
  medRequest('med-furosemide-old', 'Furosemide 40 mg tablet', '40 mg PO twice daily', '2025-09-30', {
    rxnorm: '313987',
    status: 'stopped'
  }),
  medRequest('med-amiodarone', 'Amiodarone 200 mg tablet', '200 mg PO daily', dateDaysAgo(16), {
    rxnorm: '834357',
    requester: 'Kim Briggs, MD'
  }),
  medRequest('med-lisinopril', 'Lisinopril 10 mg tablet', '10 mg PO daily', '2023-06-15', { rxnorm: '314076' }),
  medRequest('med-glargine', 'Insulin glargine (Lantus) 100 unit/mL', '24 units subcutaneous at bedtime', '2024-03-10', { rxnorm: '285018' }),
  medRequest('med-metformin', 'Metformin 500 mg tablet', '500 mg PO twice daily', '2020-01-05', { rxnorm: '861007' }),
  medRequest('med-atorvastatin', 'Atorvastatin 80 mg tablet', '80 mg PO daily', '2023-05-20', { rxnorm: '259255' }),
  medRequest('med-pantoprazole', 'Pantoprazole 40 mg tablet', '40 mg PO daily', dateDaysAgo(60), {
    rxnorm: '763563'
  }),
  medRequest('med-tiotropium', 'Tiotropium (Spiriva) 18 mcg inhaler', '1 inhalation daily', '2018-09-01', { rxnorm: '485210' }),
  medRequest('med-albuterol', 'Albuterol HFA 90 mcg inhaler', '2 puffs every 4 hours as needed for wheeze', '2018-09-01', { rxnorm: '745752' }),

  /* -------------------------------------------------------------- Allergies */
  {
    resourceType: 'AllergyIntolerance',
    id: 'allergy-pcn',
    clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }] },
    code: { text: 'Penicillin' },
    patient: PATIENT_REF,
    criticality: 'high',
    reaction: [{ manifestation: [{ text: 'Anaphylaxis' }], severity: 'severe' }]
  },
  {
    resourceType: 'AllergyIntolerance',
    id: 'allergy-contrast',
    clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }] },
    code: { text: 'Iodinated contrast media' },
    patient: PATIENT_REF,
    criticality: 'high',
    reaction: [{ manifestation: [{ text: 'Diffuse hives, wheeze' }], severity: 'moderate' }]
  },
  {
    resourceType: 'AllergyIntolerance',
    id: 'allergy-sulfa',
    clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: 'active' }] },
    code: { text: 'Sulfonamide antibiotics' },
    patient: PATIENT_REF,
    criticality: 'low',
    reaction: [{ manifestation: [{ text: 'Maculopapular rash' }], severity: 'mild' }]
  },

  /* ----------------------------------------------------------------- Device */
  {
    resourceType: 'Device',
    id: 'device-icd',
    status: 'active',
    type: { coding: [{ system: 'http://snomed.info/sct', code: '72506001', display: 'Implantable cardioverter-defibrillator' }], text: 'Implantable cardioverter-defibrillator (ICD)' },
    manufacturer: 'Medtronic',
    deviceName: [{ name: 'Evera MRI XT DR', type: 'model-name' }],
    patient: PATIENT_REF
  },

  /* ------------------------------------------- Triage vitals (current ED) */
  vital('vs-temp-1', '8310-5', 'Body temperature', 38.9, 'Cel', todayAt(14, 38), { interpretation: 'H' }),
  vital('vs-hr-1', '8867-4', 'Heart rate', 132, '/min', todayAt(14, 38), { interpretation: 'H', note: 'Irregularly irregular' }),
  vital('vs-rr-1', '9279-1', 'Respiratory rate', 26, '/min', todayAt(14, 38), { interpretation: 'H' }),
  vital('vs-spo2-1', '59408-5', 'Oxygen saturation', 88, '%', todayAt(14, 38), { interpretation: 'L', note: 'On room air' }),
  vital('vs-gcs-1', '9269-2', 'Glasgow coma score total', 14, '{score}', todayAt(14, 38)),
  vital('vs-wt-1', '29463-7', 'Body weight', 82.4, 'kg', todayAt(14, 40)),
  {
    resourceType: 'Observation',
    id: 'vs-bp-1',
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }],
    code: { coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel' }], text: 'Blood pressure' },
    subject: PATIENT_REF,
    encounter: CURRENT_ED_REF,
    effectiveDateTime: todayAt(14, 38),
    interpretation: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: 'L' }] }],
    component: [
      { code: { coding: [{ system: 'http://loinc.org', code: '8480-6', display: 'Systolic blood pressure' }] }, valueQuantity: { value: 84, unit: 'mm[Hg]' } },
      { code: { coding: [{ system: 'http://loinc.org', code: '8462-4', display: 'Diastolic blood pressure' }] }, valueQuantity: { value: 52, unit: 'mm[Hg]' } }
    ]
  },
  /* Repeat vitals after 1 L LR */
  vital('vs-hr-2', '8867-4', 'Heart rate', 124, '/min', todayAt(15, 42), { interpretation: 'H' }),
  vital('vs-spo2-2', '59408-5', 'Oxygen saturation', 93, '%', todayAt(15, 42), { note: 'On 4 L nasal cannula' }),
  {
    resourceType: 'Observation',
    id: 'vs-bp-2',
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }],
    code: { coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel' }], text: 'Blood pressure' },
    subject: PATIENT_REF,
    encounter: CURRENT_ED_REF,
    effectiveDateTime: todayAt(15, 42),
    interpretation: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: 'L' }] }],
    component: [
      { code: { coding: [{ system: 'http://loinc.org', code: '8480-6', display: 'Systolic blood pressure' }] }, valueQuantity: { value: 92, unit: 'mm[Hg]' } },
      { code: { coding: [{ system: 'http://loinc.org', code: '8462-4', display: 'Diastolic blood pressure' }] }, valueQuantity: { value: 58, unit: 'mm[Hg]' } }
    ]
  },

  /* ------------------------------------------ Labs resulted this ED visit */
  lab('lab-wbc-now', '6690-2', 'WBC', 16.8, '10*3/uL', todayAt(15, 10), { encounter: CURRENT_ED_REF, interpretation: 'H', refLow: 4.0, refHigh: 11.0 }),
  lab('lab-hgb-now', '718-7', 'Hemoglobin', 8.9, 'g/dL', todayAt(15, 10), { encounter: CURRENT_ED_REF, interpretation: 'L', refLow: 13.5, refHigh: 17.5 }),
  lab('lab-plt-now', '777-3', 'Platelets', 148, '10*3/uL', todayAt(15, 10), { encounter: CURRENT_ED_REF, refLow: 150, refHigh: 400, interpretation: 'L' }),
  lab('lab-na-now', '2951-2', 'Sodium', 131, 'mmol/L', todayAt(15, 12), { encounter: CURRENT_ED_REF, interpretation: 'L', refLow: 136, refHigh: 145 }),
  lab('lab-k-now', '2823-3', 'Potassium', 5.6, 'mmol/L', todayAt(15, 12), { encounter: CURRENT_ED_REF, interpretation: 'H', refLow: 3.5, refHigh: 5.1 }),
  lab('lab-cl-now', '2075-0', 'Chloride', 98, 'mmol/L', todayAt(15, 12), { encounter: CURRENT_ED_REF, refLow: 98, refHigh: 107 }),
  lab('lab-co2-now', '2028-9', 'CO2 (bicarbonate)', 17, 'mmol/L', todayAt(15, 12), { encounter: CURRENT_ED_REF, interpretation: 'L', refLow: 21, refHigh: 31 }),
  lab('lab-bun-now', '3094-0', 'BUN', 58, 'mg/dL', todayAt(15, 12), { encounter: CURRENT_ED_REF, interpretation: 'H', refLow: 7, refHigh: 20 }),
  lab('lab-cr-now', '2160-0', 'Creatinine', 2.4, 'mg/dL', todayAt(15, 12), { encounter: CURRENT_ED_REF, interpretation: 'H', refLow: 0.7, refHigh: 1.3 }),
  lab('lab-glu-now', '2345-7', 'Glucose', 268, 'mg/dL', todayAt(15, 12), { encounter: CURRENT_ED_REF, interpretation: 'H', refLow: 70, refHigh: 100 }),
  lab('lab-lactate-now', '2524-7', 'Lactate', 4.2, 'mmol/L', todayAt(15, 18), { encounter: CURRENT_ED_REF, interpretation: 'H', refLow: 0.5, refHigh: 2.0 }),
  lab('lab-trop-now', '89579-7', 'High-sensitivity troponin I', 89, 'ng/L', todayAt(15, 20), { encounter: CURRENT_ED_REF, interpretation: 'H', refHigh: 34, refText: '<34 ng/L' }),
  lab('lab-bnp-now', '30934-4', 'BNP', 1420, 'pg/mL', todayAt(15, 20), { encounter: CURRENT_ED_REF, interpretation: 'H', refHigh: 100, refText: '<100 pg/mL' }),
  lab('lab-inr-now', '6301-6', 'INR', 1.4, '{INR}', todayAt(15, 15), { encounter: CURRENT_ED_REF, interpretation: 'H', refLow: 0.9, refHigh: 1.1, refText: 'Note: INR does not reflect apixaban effect' }),
  lab('lab-ua-nit', '5802-4', 'Urine nitrite', 'Positive', '', todayAt(15, 35), { encounter: CURRENT_ED_REF, interpretation: 'A' }),
  lab('lab-ua-le', '5799-2', 'Urine leukocyte esterase', 'Large (3+)', '', todayAt(15, 35), { encounter: CURRENT_ED_REF, interpretation: 'A' }),
  lab('lab-ua-wbc', '5821-4', 'Urine WBC', '>100 /HPF', '', todayAt(15, 35), { encounter: CURRENT_ED_REF, interpretation: 'A' }),
  {
    resourceType: 'Observation',
    id: 'lab-bcx-pending',
    status: 'registered',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory' }] }],
    code: { coding: [{ system: 'http://loinc.org', code: '600-7', display: 'Blood culture' }], text: 'Blood cultures x2' },
    subject: PATIENT_REF,
    encounter: CURRENT_ED_REF,
    effectiveDateTime: todayAt(15, 5)
  },

  /* --------------------------------------------- Historical labs (trends) */
  lab('lab-cr-22d', '2160-0', 'Creatinine', 1.6, 'mg/dL', daysAgo(22, 20, 30), { interpretation: 'H', refLow: 0.7, refHigh: 1.3 }),
  lab('lab-cr-90d', '2160-0', 'Creatinine', 1.5, 'mg/dL', daysAgo(90, 9, 0), { interpretation: 'H', refLow: 0.7, refHigh: 1.3 }),
  lab('lab-hgb-22d', '718-7', 'Hemoglobin', 11.2, 'g/dL', daysAgo(22, 20, 30), { interpretation: 'L', refLow: 13.5, refHigh: 17.5 }),
  lab('lab-k-22d', '2823-3', 'Potassium', 4.8, 'mmol/L', daysAgo(22, 20, 30), { refLow: 3.5, refHigh: 5.1 }),
  lab('lab-bnp-22d', '30934-4', 'BNP', 890, 'pg/mL', daysAgo(22, 20, 30), { interpretation: 'H', refHigh: 100 }),
  lab('lab-a1c', '4548-4', 'Hemoglobin A1c', 8.4, '%', daysAgo(8, 9, 45), { interpretation: 'H', refHigh: 5.7 }),

  /* --------------------------------------------------- Diagnostic reports */
  {
    resourceType: 'DiagnosticReport',
    id: 'dr-ecg-now',
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'EC', display: 'Electrocardiography' }] }],
    code: { coding: [{ system: 'http://loinc.org', code: '11524-6', display: 'EKG study' }], text: '12-lead ECG' },
    subject: PATIENT_REF,
    encounter: CURRENT_ED_REF,
    effectiveDateTime: todayAt(14, 46),
    conclusion: 'Atrial fibrillation with rapid ventricular response, rate 134. QTc 478 ms (prolonged). Nonspecific ST-T wave abnormalities. Low-voltage QRS. No ST-segment elevation. Compared with ECG of ' + dateDaysAgo(22) + ': ventricular rate increased from 96, QTc increased from 448 ms.'
  },
  {
    resourceType: 'DiagnosticReport',
    id: 'dr-cxr-now',
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD', display: 'Radiology' }] }],
    code: { coding: [{ system: 'http://loinc.org', code: '30746-2', display: 'Chest X-ray portable' }], text: 'Portable chest X-ray' },
    subject: PATIENT_REF,
    encounter: CURRENT_ED_REF,
    effectiveDateTime: todayAt(15, 8),
    conclusion: 'Patchy right lower lobe opacity, possibly infectious versus asymmetric edema. Mild pulmonary vascular congestion and small bilateral pleural effusions. Dual-lead ICD in stable position. No pneumothorax.'
  },
  {
    resourceType: 'DiagnosticReport',
    id: 'dr-ct-ordered',
    status: 'registered',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'RAD', display: 'Radiology' }] }],
    code: { text: 'CT abdomen/pelvis without contrast' },
    subject: PATIENT_REF,
    encounter: CURRENT_ED_REF,
    effectiveDateTime: todayAt(15, 50),
    conclusion: 'ORDERED — pending. Non-contrast protocol selected (contrast allergy + AKI).'
  },
  {
    resourceType: 'DiagnosticReport',
    id: 'dr-echo-45d',
    status: 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0074', code: 'CUS', display: 'Cardiac Ultrasound' }] }],
    code: { text: 'Transthoracic echocardiogram' },
    subject: PATIENT_REF,
    effectiveDateTime: daysAgo(45, 11, 0),
    conclusion: 'LVEF 30%. Moderately dilated LV with global hypokinesis. Moderate mitral regurgitation. Moderately dilated left atrium. RVSP 42 mmHg.'
  },

  /* ---------------------------------- Scanned OUTSIDE records (for OCR) */
  /*
   * In live mode these are DocumentReference resources whose content.attachment
   * points at a Binary (image/PDF of scanned outside paperwork). In demo mode
   * the attachment image is generated at runtime by demo-outside-docs.js and
   * then passed through the same OCR pipeline (Tesseract.js).
   */
  {
    resourceType: 'DocumentReference',
    id: 'doc-outside-discharge',
    status: 'current',
    type: { coding: [{ system: 'http://loinc.org', code: '18842-5', display: 'Discharge summary' }], text: 'Discharge Summary (scanned outside record)' },
    category: [{ text: 'Outside Records — Scanned Media' }],
    subject: PATIENT_REF,
    date: daysAgo(58, 14, 0),
    author: [{ display: 'Percival Cox, MD' }],
    custodian: { display: 'Sacred Heart Hospital' },
    description: 'Scanned discharge summary from Sacred Heart Hospital admission ' + dateDaysAgo(64) + ' to ' + dateDaysAgo(59) + ' (upper GI bleed).',
    content: [{ attachment: { contentType: 'image/png', title: 'SHH_discharge_summary.png' } }]
  },
  {
    resourceType: 'DocumentReference',
    id: 'doc-outside-urgentcare',
    status: 'current',
    type: { coding: [{ system: 'http://loinc.org', code: '34133-9', display: 'Summary of episode note' }], text: 'Urgent Care Visit Summary (scanned outside record)' },
    category: [{ text: 'Outside Records — Scanned Media' }],
    subject: PATIENT_REF,
    date: daysAgo(4, 16, 0),
    author: [{ display: 'Douglas Murphy, MD' }],
    custodian: { display: 'WellNow Urgent Care — Sacred Heart affiliate' },
    description: 'Scanned urgent care after-visit summary from ' + dateDaysAgo(4) + ' (dysuria — started ciprofloxacin).',
    content: [{ attachment: { contentType: 'image/png', title: 'urgent_care_avs.png' } }]
  }
];

const DEMO_BUNDLE = {
  resourceType: 'Bundle',
  type: 'collection',
  entry: DEMO_RESOURCES.map(r => ({ resource: r }))
};

window.DEMO_BUNDLE = DEMO_BUNDLE;
