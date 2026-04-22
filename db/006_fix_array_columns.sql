-- ============================================================
-- Fix: Change language_preferences and regions from TEXT[]
-- to JSONB so the pg driver accepts plain JS arrays directly
-- ============================================================

-- Step 1: Add new JSONB columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS language_preferences_new JSONB DEFAULT '["en"]';
ALTER TABLE users ADD COLUMN IF NOT EXISTS regions_new JSONB DEFAULT '[]';

-- Step 2: Copy existing data across
UPDATE users
SET
  language_preferences_new = to_jsonb(language_preferences),
  regions_new = to_jsonb(regions);

-- Step 3: Drop old TEXT[] columns
ALTER TABLE users DROP COLUMN IF EXISTS language_preferences;
ALTER TABLE users DROP COLUMN IF EXISTS regions;

-- Step 4: Rename new columns to original names
ALTER TABLE users RENAME COLUMN language_preferences_new TO language_preferences;
ALTER TABLE users RENAME COLUMN regions_new TO regions;

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN ('language_preferences', 'regions');
