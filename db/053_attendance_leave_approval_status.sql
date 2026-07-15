-- ============================================================
-- Migration 053 — Add leave approval status to attendance table
-- ============================================================

-- Add leave_status column with default 'approved' for existing records (since existing leaves were already considered valid)
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS leave_status VARCHAR(20) DEFAULT 'approved'
  CHECK (leave_status IN ('pending', 'approved', 'disapproved'));

-- Set existing leaves without leave_status to 'approved'
UPDATE attendance SET leave_status = 'approved' WHERE status = 'leave' AND leave_status IS NULL;
