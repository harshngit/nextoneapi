  -- ─────────────────────────────────────────────────────────────────────────────
-- Migration: 014_phone_reveal_requests.sql
-- Creates the phone_reveal_requests table for tracking who requested
-- access to lead phone numbers, and admin approve/decline actions.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS phone_reveal_requests (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which lead's phone is being requested
  lead_id       UUID          NOT NULL REFERENCES leads(id)  ON DELETE CASCADE,

  -- Who made the request
  requested_by  UUID          NOT NULL REFERENCES users(id)  ON DELETE CASCADE,

  -- Optional reason given by the requester
  reason        TEXT,

  -- Current status
  status        VARCHAR(20)   NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','approved','declined')),

  -- Admin who acted on the request (NULL until reviewed)
  reviewed_by   UUID          REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,

  -- Optional note from reviewer (e.g. reason for decline)
  review_note   TEXT,

  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Most common query: find pending/approved requests for a specific user
CREATE INDEX IF NOT EXISTS idx_prr_requested_by_status
  ON phone_reveal_requests(requested_by, status);

-- Admin pending queue
CREATE INDEX IF NOT EXISTS idx_prr_status
  ON phone_reveal_requests(status);

-- Lead-level history
CREATE INDEX IF NOT EXISTS idx_prr_lead_id
  ON phone_reveal_requests(lead_id);

-- ── Auto-update updated_at ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_phone_reveal_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_phone_reveal_updated_at ON phone_reveal_requests;
CREATE TRIGGER trg_phone_reveal_updated_at
  BEFORE UPDATE ON phone_reveal_requests
  FOR EACH ROW EXECUTE FUNCTION update_phone_reveal_updated_at();

-- ── Comments ──────────────────────────────────────────────────────────────────
COMMENT ON TABLE  phone_reveal_requests              IS 'Tracks requests by non-admin users to view lead phone numbers';
COMMENT ON COLUMN phone_reveal_requests.status       IS 'pending | approved | declined';
COMMENT ON COLUMN phone_reveal_requests.review_note  IS 'Admin reason for approve/decline';
