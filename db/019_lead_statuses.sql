-- ============================================================
-- Migration 019 — Lead Statuses management table
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_statuses (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key          VARCHAR(50)  UNIQUE NOT NULL,   -- internal key used in DB e.g. "follow_up"
  label        VARCHAR(100) NOT NULL,           -- display label e.g. "Follow Up"
  color        VARCHAR(20)  DEFAULT '#6b7280',  -- hex color for frontend badge
  sort_order   INTEGER      DEFAULT 0,          -- controls display order
  is_active    BOOLEAN      DEFAULT true,
  is_system    BOOLEAN      DEFAULT false,      -- system statuses cannot be deleted
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_statuses_sort ON lead_statuses(sort_order ASC);

-- Seed default statuses (all marked as system — cannot be deleted)
INSERT INTO lead_statuses (key, label, color, sort_order, is_system) VALUES
  ('new',                  'New',                   '#6b7280', 1,  true),
  ('contacted',            'Contacted',             '#3b82f6', 2,  true),
  ('interested',           'Interested',            '#8b5cf6', 3,  true),
  ('follow_up',            'Follow Up',             '#f59e0b', 4,  true),
  ('site_visit_scheduled', 'Site Visit Scheduled',  '#06b6d4', 5,  true),
  ('site_visit_done',      'Site Visit Done',       '#10b981', 6,  true),
  ('negotiation',          'Negotiation',           '#f97316', 7,  true),
  ('booked',               'Booked',                '#22c55e', 8,  true),
  ('lost',                 'Lost',                  '#ef4444', 9,  true)
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE  lead_statuses          IS 'Manageable lead lifecycle statuses';
COMMENT ON COLUMN lead_statuses.key      IS 'Internal key stored in leads.status column';
COMMENT ON COLUMN lead_statuses.is_system IS 'System statuses cannot be deleted, only deactivated';
