-- Store the user's current timezone and per-meal local context.
-- Nullable columns preserve existing users and meal history.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS timezone_updated_at TIMESTAMPTZ;

ALTER TABLE public.meal_logs
  ADD COLUMN IF NOT EXISTS timezone TEXT,
  ADD COLUMN IF NOT EXISTS local_date DATE,
  ADD COLUMN IF NOT EXISTS meal_type TEXT;

CREATE INDEX IF NOT EXISTS meal_logs_user_local_date_idx
  ON public.meal_logs (user_id, local_date DESC);

COMMENT ON COLUMN public.users.timezone IS
  'Last detected IANA timezone for the user, for example Asia/Kolkata.';

COMMENT ON COLUMN public.users.timezone_updated_at IS
  'When the user timezone was last detected and stored.';

COMMENT ON COLUMN public.meal_logs.timezone IS
  'IANA timezone detected when the meal was logged.';

COMMENT ON COLUMN public.meal_logs.local_date IS
  'Local calendar date in the detected meal timezone.';

COMMENT ON COLUMN public.meal_logs.meal_type IS
  'Meal classification based on local meal time, such as Breakfast, Lunch, Dinner, or Snack.';
