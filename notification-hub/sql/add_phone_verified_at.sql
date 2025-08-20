-- Add phone_verified_at column if it doesn't exist
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz;
