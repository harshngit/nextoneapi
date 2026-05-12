-- ============================================================
-- Migration 011 — Add conversion tracking columns to leads
-- ============================================================
-- These columns are required by the convertLead endpoint
-- (PATCH /api/v1/leads/:id/convert) and the getAllLeads / 
-- getLeadById SELECT queries.
-- Using IF NOT EXISTS so re-running this migration is safe.
-- ============================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS is_converted  BOOLEAN     DEFAULT false,
  ADD COLUMN IF NOT EXISTS converted_at  TIMESTAMPTZ DEFAULT NULL;

-- Index to quickly find all converted leads
CREATE INDEX IF NOT EXISTS idx_leads_is_converted ON leads(is_converted);
