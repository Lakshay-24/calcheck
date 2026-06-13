-- Production Razorpay subscription state.
-- users.is_pro remains the app entitlement source of truth.

ALTER TABLE public.users
  ALTER COLUMN subscription_status SET DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS razorpay_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_plan_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_currency TEXT,
  ADD COLUMN IF NOT EXISTS billing_country TEXT,
  ADD COLUMN IF NOT EXISTS current_period_start TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS grace_period_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS subscription_cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS subscription_updated_at TIMESTAMPTZ;

UPDATE public.users
  SET subscription_status = 'free'
  WHERE subscription_status IS NULL;

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'razorpay',
  provider_subscription_id TEXT UNIQUE NOT NULL,
  provider_customer_id TEXT,
  provider_plan_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  currency TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  billing_country TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  grace_period_until TIMESTAMPTZ,
  last_payment_at TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled_at TIMESTAMPTZ,
  raw_subscription JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx
  ON public.subscriptions (user_id);

CREATE INDEX IF NOT EXISTS subscriptions_provider_subscription_id_idx
  ON public.subscriptions (provider_subscription_id);

CREATE TABLE IF NOT EXISTS public.razorpay_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  provider_subscription_id TEXT,
  provider_payment_id TEXT,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.razorpay_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own subscriptions"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

COMMENT ON COLUMN public.users.is_pro IS
  'Entitlement source of truth. Updated only by trusted backend subscription flows.';

CREATE OR REPLACE FUNCTION public.prevent_client_subscription_field_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF
      NEW.is_pro IS DISTINCT FROM FALSE OR
      COALESCE(NEW.subscription_status, 'free') IS DISTINCT FROM 'free' OR
      NEW.razorpay_customer_id IS NOT NULL OR
      NEW.razorpay_subscription_id IS NOT NULL OR
      NEW.razorpay_plan_id IS NOT NULL OR
      NEW.subscription_currency IS NOT NULL OR
      NEW.current_period_start IS NOT NULL OR
      NEW.current_period_end IS NOT NULL OR
      NEW.grace_period_until IS NOT NULL OR
      NEW.last_payment_at IS NOT NULL OR
      NEW.subscription_cancel_at_period_end IS DISTINCT FROM FALSE OR
      NEW.subscription_cancelled_at IS NOT NULL OR
      NEW.subscription_updated_at IS NOT NULL
    THEN
      RAISE EXCEPTION 'Subscription fields can only be set by trusted backend services';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF
      NEW.is_pro IS DISTINCT FROM OLD.is_pro OR
      NEW.subscription_status IS DISTINCT FROM OLD.subscription_status OR
      NEW.razorpay_customer_id IS DISTINCT FROM OLD.razorpay_customer_id OR
      NEW.razorpay_subscription_id IS DISTINCT FROM OLD.razorpay_subscription_id OR
      NEW.razorpay_plan_id IS DISTINCT FROM OLD.razorpay_plan_id OR
      NEW.subscription_currency IS DISTINCT FROM OLD.subscription_currency OR
      NEW.billing_country IS DISTINCT FROM OLD.billing_country OR
      NEW.current_period_start IS DISTINCT FROM OLD.current_period_start OR
      NEW.current_period_end IS DISTINCT FROM OLD.current_period_end OR
      NEW.grace_period_until IS DISTINCT FROM OLD.grace_period_until OR
      NEW.last_payment_at IS DISTINCT FROM OLD.last_payment_at OR
      NEW.subscription_cancel_at_period_end IS DISTINCT FROM OLD.subscription_cancel_at_period_end OR
      NEW.subscription_cancelled_at IS DISTINCT FROM OLD.subscription_cancelled_at OR
      NEW.subscription_updated_at IS DISTINCT FROM OLD.subscription_updated_at
    THEN
      RAISE EXCEPTION 'Subscription fields can only be updated by trusted backend services';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_client_subscription_field_mutation_trigger ON public.users;

CREATE TRIGGER prevent_client_subscription_field_mutation_trigger
  BEFORE INSERT OR UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_client_subscription_field_mutation();
