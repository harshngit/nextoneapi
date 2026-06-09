-- ============================================================
-- Migration 027 — Add attendance_reminder to notifications type CHECK
-- ============================================================

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    -- Leads
    'lead_assigned',
    'lead_status_changed',
    'lead_new',

    -- Follow-ups / Tasks
    'follow_up_created',
    'follow_up_due',
    'follow_up_overdue',
    'follow_up_completed',
    'task_created',
    'task_reminder',
    'task_completed',

    -- Site visits
    'visit_scheduled',
    'visit_reminder',
    'visit_done',
    'visit_cancelled',
    'visit_rescheduled',

    -- Booking & payments
    'booking_new',
    'payment_received',
    'commission_credited',

    -- Projects
    'project_new',
    'project_updated',

    -- Attendance
    'attendance_checkin',
    'attendance_checkout',
    'attendance_pending',
    'attendance_manual',
    'attendance_approved',
    'attendance_reminder',   -- ← NEW: daily check-in reminder

    -- General
    'general'
  ));
