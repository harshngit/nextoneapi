-- ============================================================
-- Migration 021 — Fix missing user address and emergency contact fields
-- This ensures the fields used in user profiles are present in the database.
-- ============================================================

-- 1. Add employee address to users table if it doesn't exist
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS address TEXT;

-- 2. Add emergency contact number to users table if it doesn't exist
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS emergency_contact_number VARCHAR(20);

-- 3. Add comments for clarity
COMMENT ON COLUMN users.address                    IS 'Employee residential address';
COMMENT ON COLUMN users.emergency_contact_number   IS 'Employee emergency contact phone number';
