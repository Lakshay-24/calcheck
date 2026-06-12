-- Store the frontend-selected portion multiplier used for saved nutrition values.
-- Nullable so existing meal history remains unchanged.

ALTER TABLE public.meal_logs
  ADD COLUMN IF NOT EXISTS portion_multiplier NUMERIC;

COMMENT ON COLUMN public.meal_logs.portion_multiplier IS
  'Frontend portion multiplier applied to saved nutrition values: 0.75, 1.0, or 1.5.';
