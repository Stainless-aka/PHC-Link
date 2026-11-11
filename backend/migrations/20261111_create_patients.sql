-- PHC Link: facility-scoped patient registry
CREATE TABLE IF NOT EXISTS public.patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id uuid NOT NULL REFERENCES public.facilities(id) ON DELETE RESTRICT,
  patient_code text NOT NULL,
  full_name text NOT NULL CHECK (char_length(trim(full_name)) BETWEEN 2 AND 160),
  date_of_birth date,
  sex text CHECK (sex IS NULL OR sex IN ('female','male','unknown')),
  phone text,
  created_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (facility_id, patient_code)
);
CREATE INDEX IF NOT EXISTS patients_facility_created_idx
  ON public.patients(facility_id, created_at DESC);
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.patients FROM anon, authenticated;
