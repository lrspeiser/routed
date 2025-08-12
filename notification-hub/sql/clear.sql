-- Danger: wipes all application data
-- Usage:
--   psql "$DATABASE_URL" -f notification-hub/sql/clear.sql

BEGIN;

-- Truncate all hub tables and cascade to dependents
TRUNCATE TABLE
  deliveries,
  messages,
  devices,
  channels,
  subscriptions,
  users,
  publishers,
  topics,
  tenants
RESTART IDENTITY CASCADE;

COMMIT;


