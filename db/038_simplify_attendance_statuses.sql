-- ============================================================
-- Migration 038 — Simplify attendance to 4 statuses
-- ============================================================
-- Old statuses: present, absent, late, on_leave, half_day
-- New statuses: present, absent, late, leave
--
-- Safe to re-run.
-- ============================================================

-- Step 1: Drop the old CHECK constraint
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_status_check;

-- Step 2: Migrate existing data FIRST (before adding new constraint)
UPDATE attendance
SET status = 'leave', updated_at = NOW()
WHERE status IN ('on_leave', 'half_day');

-- Step 3: Add new CHECK constraint
ALTER TABLE attendance ADD CONSTRAINT attendance_status_check
  CHECK (status IN ('present', 'absent', 'late', 'leave'));
