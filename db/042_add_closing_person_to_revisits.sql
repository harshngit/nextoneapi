-- ============================================================
-- Migration 042 — Add closing_person (free-text name) to site_visits and site_revisits
-- ============================================================

ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS closing_person VARCHAR(255);

ALTER TABLE site_revisits
  ADD COLUMN IF NOT EXISTS closing_person VARCHAR(255);
