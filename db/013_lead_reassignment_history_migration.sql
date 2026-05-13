-- ============================================================
-- Next One Realty CRM — Migration
-- Table: lead_reassignment_history
-- Description: Track lead reassignment history with reason and performer
-- ============================================================

-- ─── Lead Reassignment History Table ──────────────────────────
CREATE TABLE IF NOT EXISTS lead_reassignment_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id         UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  to_user_id      UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  reason          TEXT,
  performed_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_lead_reassignment_lead 
  ON lead_reassignment_history(lead_id);
  
CREATE INDEX IF NOT EXISTS idx_lead_reassignment_from_user 
  ON lead_reassignment_history(from_user_id);
  
CREATE INDEX IF NOT EXISTS idx_lead_reassignment_to_user 
  ON lead_reassignment_history(to_user_id);
  
CREATE INDEX IF NOT EXISTS idx_lead_reassignment_created_at 
  ON lead_reassignment_history(created_at);

-- ─── Comments ─────────────────────────────────────────────────
COMMENT ON TABLE lead_reassignment_history IS 'Tracks all lead reassignments with full audit trail';
COMMENT ON COLUMN lead_reassignment_history.from_user_id IS 'Previous assignee (can be NULL if lead was unassigned)';
COMMENT ON COLUMN lead_reassignment_history.to_user_id IS 'New assignee';
COMMENT ON COLUMN lead_reassignment_history.reason IS 'Reason for reassignment (optional)';
COMMENT ON COLUMN lead_reassignment_history.performed_by IS 'Admin/Manager who performed the reassignment';
