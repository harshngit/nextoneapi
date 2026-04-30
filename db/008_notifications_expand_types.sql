-- ============================================================
-- Next One Realty CRM — Migration 008
-- Expand notifications.type enum + add metadata column
-- Run this migration on your existing database
-- ============================================================

-- ─── Step 1: Drop the existing type CHECK constraint ────────
-- PostgreSQL doesn't support ALTER TABLE ... ALTER COLUMN ... CHECK inline,
-- so we drop + re-add the constraint.

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

-- ─── Step 2: Add the new expanded CHECK constraint ──────────
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    -- Lead notifications
    'lead_assigned',
    'lead_status_changed',
    'lead_new',

    -- Follow-up notifications
    'follow_up_created',
    'follow_up_due',
    'follow_up_overdue',
    'follow_up_completed',

    -- Site visit notifications
    'visit_scheduled',
    'visit_reminder',
    'visit_done',
    'visit_cancelled',
    'visit_rescheduled',

    -- Project notifications
    'project_new',
    'project_updated',

    -- Booking & payment notifications
    'booking_new',
    'payment_received',
    'commission_credited',

    -- Task notifications
    'task_created',
    'task_reminder',
    'task_completed',

    -- General
    'general'
  ));

-- ─── Step 3: Add metadata JSONB column (optional extra data per notification) ─
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;

-- ─── Step 4: Add index on type for faster filter queries ────
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- ─── Step 5: Add index on created_at for ordering performance ─
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- ─── Step 6: Migrate old type values to new names ───────────
-- 'task_created' was previously 'task_created' (no change)
-- 'visit_scheduled' was previously 'visit_scheduled' (no change)
-- Map old 'status_change' → 'lead_status_changed'
UPDATE notifications SET type = 'lead_status_changed' WHERE type = 'status_change';

-- ─── Verify ─────────────────────────────────────────────────
-- SELECT DISTINCT type, COUNT(*) FROM notifications GROUP BY type ORDER BY type;
