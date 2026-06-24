-- ============================================================
-- Next One Realty CRM — Migration 040
-- WhatsApp tracking columns for: leads, site_revisits, lead_closures, tasks
-- Mirrors the pattern from migration 016 (site_visits whatsapp_* columns)
-- Safe to re-run.
-- ============================================================

-- ─── leads ──────────────────────────────────────────────────────────────────
-- welcome message (on creation), and one flag per client-facing status message
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS whatsapp_welcome_sent              BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_interested_sent           BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_negotiation_sent          BOOLEAN DEFAULT false;

-- ─── site_revisits ──────────────────────────────────────────────────────────
-- Separate from the existing generic `visit_reminder_sent` (in-app push) column —
-- these are WhatsApp-specific so each channel can be tracked/retried independently.
ALTER TABLE site_revisits
  ADD COLUMN IF NOT EXISTS whatsapp_confirmation_sent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_1day_sent         BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_2hour_sent        BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_site_revisits_wa_cron
  ON site_revisits(visit_date, status, whatsapp_1day_sent, whatsapp_2hour_sent);

-- ─── lead_closures ──────────────────────────────────────────────────────────
ALTER TABLE lead_closures
  ADD COLUMN IF NOT EXISTS whatsapp_confirmed_sent BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_cancelled_sent BOOLEAN DEFAULT false;

-- ─── tasks ──────────────────────────────────────────────────────────────────
-- Client-facing "we'll be in touch" message, distinct from the existing internal
-- staff email (notifyFollowUpCreated) — that one is unaffected by this column.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS whatsapp_followup_sent BOOLEAN DEFAULT false;

COMMENT ON COLUMN leads.whatsapp_welcome_sent           IS 'True once the lead-creation WhatsApp welcome message has been sent';
COMMENT ON COLUMN leads.whatsapp_interested_sent        IS 'True once the "interested" status WhatsApp message has been sent';
COMMENT ON COLUMN leads.whatsapp_negotiation_sent       IS 'True once the "negotiation" status WhatsApp message has been sent';
COMMENT ON COLUMN site_revisits.whatsapp_confirmation_sent IS 'True once the re-visit confirmation WhatsApp message has been sent';
COMMENT ON COLUMN site_revisits.whatsapp_1day_sent         IS 'True once the 1-day-before re-visit WhatsApp reminder has been sent';
COMMENT ON COLUMN site_revisits.whatsapp_2hour_sent        IS 'True once the 2-hour-before re-visit WhatsApp reminder has been sent';
COMMENT ON COLUMN lead_closures.whatsapp_confirmed_sent IS 'True once the booking-confirmed WhatsApp message has been sent';
COMMENT ON COLUMN lead_closures.whatsapp_cancelled_sent IS 'True once the booking-cancelled/on-hold WhatsApp message has been sent';
COMMENT ON COLUMN tasks.whatsapp_followup_sent IS 'True once the client-facing follow-up-scheduled WhatsApp message has been sent';
