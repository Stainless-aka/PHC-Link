ALTER TABLE public.referrals
  ADD COLUMN IF NOT EXISTS patient_id uuid
  REFERENCES public.patients(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS referrals_patient_id_idx
  ON public.referrals(patient_id);
