-- Mock Pro entitlement for the monetization MVP.
-- Payment verification will be added later; this flag is user-owned for testing.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS is_pro BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.users.is_pro IS
  'Mock CalCheck Pro entitlement for MVP testing. True grants unlimited AI scans.';
