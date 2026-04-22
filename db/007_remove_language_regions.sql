-- ============================================================
-- Next One Realty CRM — Migration 007
-- Remove language_preferences and regions columns from users
-- ============================================================

ALTER TABLE users DROP COLUMN IF EXISTS language_preferences;
ALTER TABLE users DROP COLUMN IF EXISTS regions;

-- Verify final users table structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;
