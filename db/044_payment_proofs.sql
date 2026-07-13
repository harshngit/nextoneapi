-- ============================================================
-- Migration 044 — Payment Proofs on leads (booking receipts / screenshots)
-- Mirrors the call_recordings table/flow: upload a file, get a url back,
-- attach it to a lead via JSON, list/update/delete per lead.
-- ============================================================

CREATE TABLE IF NOT EXISTS payment_proofs (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id      UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  url          TEXT        NOT NULL,
  name         VARCHAR(255),
  amount       VARCHAR(100),
  file_size    BIGINT,
  uploaded_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_proofs_lead ON payment_proofs(lead_id);

COMMENT ON COLUMN payment_proofs.amount IS 'Free-text payment amount as shown on the proof (e.g. receipt/screenshot)';
