ALTER TABLE patients ADD COLUMN IF NOT EXISTS address TEXT;

CREATE TABLE IF NOT EXISTS anc_pregnancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  pregnancy_number SMALLINT NOT NULL CHECK (pregnancy_number > 0),
  lmp DATE NOT NULL,
  edd DATE NOT NULL,
  previous_pregnancy_history TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','delivered','closed','transferred')),
  registered_by UUID NOT NULL REFERENCES users(id),
  operation_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS anc_pregnancies_facility_status_idx ON anc_pregnancies(facility_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS anc_pregnancies_patient_idx ON anc_pregnancies(patient_id,created_at DESC);

CREATE TABLE IF NOT EXISTS anc_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pregnancy_id UUID NOT NULL REFERENCES anc_pregnancies(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES facilities(id),
  visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  weight_kg NUMERIC(5,2) CHECK (weight_kg IS NULL OR weight_kg BETWEEN 1 AND 350),
  systolic_bp SMALLINT CHECK (systolic_bp IS NULL OR systolic_bp BETWEEN 40 AND 300),
  diastolic_bp SMALLINT CHECK (diastolic_bp IS NULL OR diastolic_bp BETWEEN 20 AND 200),
  temperature_c NUMERIC(4,1) CHECK (temperature_c IS NULL OR temperature_c BETWEEN 30 AND 45),
  clinical_observations TEXT,
  gestational_age_weeks SMALLINT CHECK (gestational_age_weeks IS NULL OR gestational_age_weeks BETWEEN 0 AND 45),
  recorded_by UUID NOT NULL REFERENCES users(id),
  operation_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS anc_visits_pregnancy_date_idx ON anc_visits(pregnancy_id,visit_date DESC);

CREATE TABLE IF NOT EXISTS anc_lab_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pregnancy_id UUID NOT NULL REFERENCES anc_pregnancies(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES facilities(id),
  test_type TEXT NOT NULL CHECK (test_type IN ('blood_group','genotype','hiv','hepatitis_b','malaria','urine','blood_sugar','haemoglobin','other')),
  result TEXT NOT NULL,
  tested_at DATE NOT NULL DEFAULT CURRENT_DATE,
  consent_obtained BOOLEAN NOT NULL DEFAULT FALSE,
  confidential BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  recorded_by UUID NOT NULL REFERENCES users(id),
  operation_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (test_type NOT IN ('hiv','hepatitis_b') OR consent_obtained = TRUE)
);
CREATE INDEX IF NOT EXISTS anc_lab_results_pregnancy_idx ON anc_lab_results(pregnancy_id,tested_at DESC);

CREATE TABLE IF NOT EXISTS anc_risk_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pregnancy_id UUID NOT NULL REFERENCES anc_pregnancies(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES facilities(id),
  category TEXT NOT NULL CHECK (category IN ('hypertension','severe_anemia','previous_complication','bleeding','severe_headache','visual_changes','fever','reduced_fetal_movement','other')),
  severity TEXT NOT NULL DEFAULT 'high' CHECK (severity IN ('moderate','high','urgent')),
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','resolved')),
  created_by UUID NOT NULL REFERENCES users(id),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  operation_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS anc_risk_flags_open_idx ON anc_risk_flags(facility_id,status,severity,created_at DESC);

CREATE TABLE IF NOT EXISTS anc_medications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pregnancy_id UUID NOT NULL REFERENCES anc_pregnancies(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES facilities(id),
  medication_name TEXT NOT NULL,
  dose TEXT,
  frequency TEXT,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  instructions TEXT,
  prescribed_by UUID NOT NULL REFERENCES users(id),
  operation_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS anc_appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pregnancy_id UUID NOT NULL REFERENCES anc_pregnancies(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES facilities(id),
  appointment_date DATE NOT NULL,
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','completed','missed','cancelled')),
  created_by UUID NOT NULL REFERENCES users(id),
  operation_id UUID NOT NULL UNIQUE,
  completed_visit_id UUID REFERENCES anc_visits(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS anc_appointments_due_idx ON anc_appointments(facility_id,status,appointment_date);

CREATE TABLE IF NOT EXISTS anc_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pregnancy_id UUID NOT NULL UNIQUE REFERENCES anc_pregnancies(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES facilities(id),
  delivery_date DATE NOT NULL,
  delivery_method TEXT NOT NULL CHECK (delivery_method IN ('vaginal','assisted_vaginal','caesarean','other')),
  baby_condition TEXT,
  birth_outcome TEXT NOT NULL CHECK (birth_outcome IN ('live_birth','stillbirth','neonatal_death','other')),
  complications TEXT,
  notes TEXT,
  recorded_by UUID NOT NULL REFERENCES users(id),
  operation_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS anc_postnatal_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pregnancy_id UUID NOT NULL REFERENCES anc_pregnancies(id) ON DELETE CASCADE,
  facility_id UUID NOT NULL REFERENCES facilities(id),
  visit_date DATE NOT NULL,
  follow_up_for TEXT NOT NULL CHECK (follow_up_for IN ('mother','newborn','both')),
  observations TEXT,
  danger_signs TEXT,
  next_visit_date DATE,
  recorded_by UUID NOT NULL REFERENCES users(id),
  operation_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE anc_pregnancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE anc_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE anc_lab_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE anc_risk_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE anc_medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE anc_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE anc_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE anc_postnatal_visits ENABLE ROW LEVEL SECURITY;