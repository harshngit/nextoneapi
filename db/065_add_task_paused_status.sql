-- Adds a "paused" state to follow-up tasks (d:\Clients\nextone\frontend's
-- Follow-Ups page) — a task the assignee wants to put on hold without
-- marking it done and without it counting toward overdue/reminder noise.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_paused BOOLEAN NOT NULL DEFAULT false;

-- Rebuild the reminder-cron index to include is_paused, since both reminder
-- jobs in reminderCron.js now filter on it.
DROP INDEX IF EXISTS idx_tasks_reminder_cron;
CREATE INDEX IF NOT EXISTS idx_tasks_reminder_cron ON tasks(due_date, is_completed, is_paused, follow_up_reminder_sent);

COMMENT ON COLUMN tasks.is_paused IS 'True when the assignee has put this follow-up on hold — excluded from overdue/reminder logic until resumed';
