-- PHC Link: separate account authorization from professional designation.
-- Existing clinician accounts keep their facility assignments and become
-- health_worker accounts with emergency referral response explicitly enabled.

BEGIN;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS designation VARCHAR(50),
  ADD COLUMN IF NOT EXISTS can_respond_emergency BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
DECLARE
  constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', constraint_row.conname);
  END LOOP;
END
$$;

UPDATE public.users
SET role = 'health_worker',
    designation = COALESCE(NULLIF(designation, ''), 'other'),
    can_respond_emergency = TRUE,
    updated_at = NOW()
WHERE role = 'clinician';

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('health_worker', 'lga_officer', 'state_admin', 'system_admin'));

COMMIT;
