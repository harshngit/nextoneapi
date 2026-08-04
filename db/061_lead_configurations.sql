-- ============================================================
-- Migration 061 — Lead configurations (1RK, 1BHK, 2BHK, ...)
-- ============================================================
-- Standardizes the free-text `leads.configuration` field into a managed
-- dropdown, same pattern as lead_sources (migration in 000_master_schema.sql).

CREATE TABLE IF NOT EXISTS lead_configurations (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       VARCHAR(100) UNIQUE NOT NULL,
  is_active  BOOLEAN     DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO lead_configurations (name) VALUES
  ('1RK'),
  ('1BHK'),
  ('2BHK'),
  ('3BHK'),
  ('4BHK'),
  ('Penta House / Duplex'),
  ('Commercial Shop'),
  ('Office Space')
ON CONFLICT (name) DO NOTHING;
