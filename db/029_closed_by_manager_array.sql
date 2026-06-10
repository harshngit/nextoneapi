-- ============================================================
-- Migration 029 — Change closed_by_manager from UUID to UUID[]
-- Allows multiple managers to be associated with a closure
-- ============================================================

-- Drop the old foreign key constraint and convert to UUID array
ALTER TABLE lead_closures
  DROP CONSTRAINT IF EXISTS lead_closures_closed_by_manager_fkey;

ALTER TABLE lead_closures
  ALTER COLUMN closed_by_manager TYPE UUID[]
  USING CASE
    WHEN closed_by_manager IS NULL THEN NULL
    ELSE ARRAY[closed_by_manager]
  END;

COMMENT ON COLUMN lead_closures.closed_by_manager IS 'Array of manager UUIDs who supervised this closure';
