-- Add structured AI analysis fields returned by analyzeFood().
-- All columns are nullable so existing meal history is preserved.

ALTER TABLE public.meal_logs
  ADD COLUMN IF NOT EXISTS portion_size TEXT,
  ADD COLUMN IF NOT EXISTS estimated_grams NUMERIC,
  ADD COLUMN IF NOT EXISTS portion_confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS confidence NUMERIC,
  ADD COLUMN IF NOT EXISTS candidates JSONB;

COMMENT ON COLUMN public.meal_logs.portion_size IS
  'AI-estimated serving size: Small, Medium, or Large.';

COMMENT ON COLUMN public.meal_logs.estimated_grams IS
  'AI-estimated portion weight in grams.';

COMMENT ON COLUMN public.meal_logs.portion_confidence IS
  'AI confidence for the portion estimate, from 0.0 to 1.0.';

COMMENT ON COLUMN public.meal_logs.confidence IS
  'AI confidence for the primary food identification, from 0.0 to 1.0.';

COMMENT ON COLUMN public.meal_logs.candidates IS
  'Ranked alternate food identification candidates returned by AI.';
