-- ============================================================
-- Migration 039 — Fix attendance status CHECK constraint
-- ============================================================
-- Run this on production if 038 failed or wasn't applied.
-- Drops any existing constraint, migrates data, then adds
-- the new constraint allowing only: present, absent, late, leave
--
-- Safe to re-run.
-- ============================================================

-- Drop old constraint (may be named differently on some DBs)
DO $$
BEGIN
  ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_status_check;
  ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Migrate old status values
UPDATE attendance SET status = 'leave', updated_at = NOW()
WHERE status IN ('on_leave', 'half_day');

-- Add new constraint
ALTER TABLE attendance ADD CONSTRAINT attendance_status_check
  CHECK (status IN ('present', 'absent', 'late', 'leave'));
