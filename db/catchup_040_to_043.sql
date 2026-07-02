-- ============================================================
-- Catch-up: Migrations 040 → 043
-- Run this on a database that already has the base schema
-- but is missing these 4 migrations.
-- Safe to re-run (all ADD COLUMN IF NOT EXISTS).
-- ============================================================

-- ─── Migration 040: WhatsApp tracking columns ───────────────

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS whatsapp_welcome_sent     BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_interested_sent  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_negotiation_sent BOOLEAN DEFAULT false;

ALTER TABLE site_revisits
  ADD COLUMN IF NOT EXISTS whatsapp_confirmation_sent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_1day_sent         BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_2hour_sent        BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_site_revisits_wa_cron
  ON site_revisits(visit_date, status, whatsapp_1day_sent, whatsapp_2hour_sent);

ALTER TABLE lead_closures
  ADD COLUMN IF NOT EXISTS whatsapp_confirmed_sent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_cancelled_sent BOOLEAN DEFAULT false;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS whatsapp_followup_sent BOOLEAN DEFAULT false;

-- ─── Migration 041: closing_manager on visits ───────────────

ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS closing_manager UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE site_revisits
  ADD COLUMN IF NOT EXISTS closing_manager UUID REFERENCES users(id) ON DELETE SET NULL;

-- ─── Migration 042: closing_person (free-text) on visits ────

ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS closing_person VARCHAR(255);

ALTER TABLE site_revisits
  ADD COLUMN IF NOT EXISTS closing_person VARCHAR(255);

-- ─── Migration 043: project_name_text on leads ──────────────

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS project_name_text TEXT;

-- ─── Missing index from master schema (safe to add now) ─────

CREATE INDEX IF NOT EXISTS idx_site_visits_date_status
  ON site_visits(visit_date, status);
