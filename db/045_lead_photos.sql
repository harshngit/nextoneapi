-- ============================================================
-- Migration 045 — Lead Photos (front-page form photo, separate from payment proof)
-- Mirrors the call_recordings table/flow: upload a file, get a url back,
-- attach it to a lead via JSON, list/update/delete per lead.
-- ============================================================

CREATE TABLE IF NOT EXISTS lead_photos (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id      UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  url          TEXT        NOT NULL,
  name         VARCHAR(255),
  file_size    BIGINT,
  uploaded_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_photos_lead ON lead_photos(lead_id);
