-- Keep only the most recently assigned active facility for each facility-based user.
WITH ranked_assignments AS (
  SELECT facility_id, user_id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY assigned_at DESC NULLS LAST, facility_id) AS assignment_rank
  FROM public.facility_users WHERE is_active = TRUE
)
UPDATE public.facility_users fu SET is_active = FALSE
FROM ranked_assignments ranked WHERE fu.facility_id = ranked.facility_id AND fu.user_id = ranked.user_id AND ranked.assignment_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS facility_users_one_active_facility_per_user
  ON public.facility_users (user_id) WHERE is_active = TRUE;
