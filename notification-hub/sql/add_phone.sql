-- Add phone support to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone text;

-- Unique per tenant+phone when phone is provided
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'users_tenant_phone_unique'
  ) THEN
    CREATE UNIQUE INDEX users_tenant_phone_unique ON users (tenant_id, phone) WHERE phone IS NOT NULL;
  END IF;
EXCEPTION WHEN others THEN
  -- ignore if insufficient permissions or already exists
  NULL;
END $$;


