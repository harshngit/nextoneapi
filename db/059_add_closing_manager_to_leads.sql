-- ============================================================
-- Migration 059 — Add closing_manager to leads
-- ============================================================
-- Mirrors closing_manager on site_visits/site_revisits (migration 041), but
-- at the lead level — set when a site visit/re-visit is marked 'done' so it
-- persists on the lead itself instead of only living on the individual visit.

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS closing_manager UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_closing_manager ON leads(closing_manager);
