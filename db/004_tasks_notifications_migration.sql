-- ============================================================
-- Next One Realty CRM — Migration
-- Tables: tasks, notifications
-- ============================================================

-- ─── Tasks Table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tasks (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title        VARCHAR(255) NOT NULL,
  lead_id      UUID REFERENCES leads(id) ON DELETE CASCADE,
  due_date     TIMESTAMPTZ NOT NULL,
  assigned_to  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  priority     VARCHAR(10) DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  notes        TEXT,
  is_completed BOOLEAN DEFAULT false,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to  ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_lead_id      ON tasks(lead_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date     ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_is_completed ON tasks(is_completed);

-- ─── Notifications Table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type           VARCHAR(50) NOT NULL CHECK (type IN (
                   'lead_assigned','task_created','task_reminder',
                   'visit_scheduled','visit_reminder','status_change','general'
                 )),
  title          VARCHAR(255) NOT NULL,
  message        TEXT NOT NULL,
  is_read        BOOLEAN DEFAULT false,
  reference_id   UUID,
  reference_type VARCHAR(50),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
