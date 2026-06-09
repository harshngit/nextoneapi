-- ============================================================
-- Migration 028 — Add reminder_sent tracking columns
-- Prevents duplicate reminders if the cron runs multiple times
-- ============================================================

-- ─── tasks ───────────────────────────────────────────────────
-- follow_up_reminder_sent: fires ~2 hours before due_date
-- follow_up_overdue_sent:  fires when due_date has passed and task is still open
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS follow_up_reminder_sent  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS follow_up_overdue_sent   BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tasks_reminder_cron
  ON tasks(due_date, is_completed, follow_up_reminder_sent);

-- ─── site_visits ─────────────────────────────────────────────
-- visit_reminder_sent: fires ~2 hours before the visit datetime
ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS visit_reminder_sent BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_site_visits_reminder_cron
  ON site_visits(visit_date, status, visit_reminder_sent);

-- ─── site_revisits ───────────────────────────────────────────
ALTER TABLE site_revisits
  ADD COLUMN IF NOT EXISTS visit_reminder_sent BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_site_revisits_reminder_cron
  ON site_revisits(visit_date, status, visit_reminder_sent);

COMMENT ON COLUMN tasks.follow_up_reminder_sent  IS 'True once the 2-hour-before reminder push has been sent';
COMMENT ON COLUMN tasks.follow_up_overdue_sent   IS 'True once the overdue reminder push has been sent';
COMMENT ON COLUMN site_visits.visit_reminder_sent  IS 'True once the 2-hour-before visit reminder push has been sent';
COMMENT ON COLUMN site_revisits.visit_reminder_sent IS 'True once the 2-hour-before re-visit reminder push has been sent';
