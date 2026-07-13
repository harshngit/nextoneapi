-- ============================================================
-- Migration 049 — Closure Documents (cost sheet, payment proof)
-- Mirrors the payment_proofs/lead_photos table/flow: upload a file, get a
-- url back, attach it to a closure via JSON, list/update/delete per closure.
-- ============================================================

CREATE TABLE IF NOT EXISTS closure_documents (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  closure_id    UUID        NOT NULL REFERENCES lead_closures(id) ON DELETE CASCADE,
  document_type VARCHAR(20) NOT NULL CHECK (document_type IN ('cost_sheet','payment_proof')),
  url           TEXT        NOT NULL,
  name          VARCHAR(255),
  file_size     BIGINT,
  mime_type     VARCHAR(100),
  uploaded_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_closure_documents_closure ON closure_documents(closure_id);

COMMENT ON COLUMN closure_documents.document_type IS 'cost_sheet or payment_proof — accepts images (jpeg/png/webp) or PDF';
