-- Adds a description column to channels; safe to run repeatedly
ALTER TABLE channels ADD COLUMN IF NOT EXISTS description text;

