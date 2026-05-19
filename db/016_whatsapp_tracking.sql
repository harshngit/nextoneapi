-- Migration 016: Add WhatsApp reminder tracking columns to site_visits
-- Prevents double-sending if the cron runs multiple times

ALTER TABLE site_visits
  ADD COLUMN IF NOT EXISTS whatsapp_confirmation_sent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_1day_sent         BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_today_sent        BOOLEAN DEFAULT false;

-- Index for cron query performance
CREATE INDEX IF NOT EXISTS idx_site_visits_date_status
  ON site_visits(visit_date, status);
