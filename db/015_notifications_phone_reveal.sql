-- ============================================================
-- Migration 015: Add phone_reveal to notifications reference_type
-- Run this after 014_phone_reveal_requests.sql
-- ============================================================

-- The notifications table reference_type column is TEXT with no constraint
-- so no migration is strictly needed for reference_type = 'phone_reveal'.
-- However we do need to ensure 'general' is in the type CHECK constraint
-- (it should already be from migration 008, but this is a safety check).

-- Verify 'general' is allowed (no-op if already there):
DO $$
BEGIN
  -- Drop and recreate constraint only if 'general' is missing
  -- (safe because 008 already added it — this is a no-op guard)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_type_check'
      AND conrelid = 'notifications'::regclass
  ) THEN
    ALTER TABLE notifications
      ADD CONSTRAINT notifications_type_check CHECK (type IN (
        'lead_assigned','lead_status_changed','lead_new',
        'follow_up_created','follow_up_due','follow_up_overdue','follow_up_completed',
        'visit_scheduled','visit_reminder','visit_done','visit_cancelled','visit_rescheduled',
        'project_new','project_updated',
        'booking_new','payment_received','commission_credited',
        'task_created','task_reminder','task_completed',
        'attendance_checkin','attendance_checkout','attendance_pending',
        'attendance_manual','attendance_approved',
        'general'
      ));
  END IF;
END $$;

-- Add reference_id and reference_type columns if missing (safe no-op guards)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_id   UUID;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS reference_type VARCHAR(50);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata       JSONB DEFAULT NULL;
