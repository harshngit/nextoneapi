-- ============================================================
-- Migration 017 — Add callback_time, next_followup_time to leads
-- ============================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS callback_time       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_followup_time  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_leads_callback_time      ON leads(callback_time);
CREATE INDEX IF NOT EXISTS idx_leads_next_followup_time ON leads(next_followup_time);

COMMENT ON COLUMN leads.callback_time      IS 'Scheduled time to call the lead back';
COMMENT ON COLUMN leads.next_followup_time IS 'Scheduled time for the next follow-up';

-- Add voice recording and new fields to leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS voice_recording_url  TEXT,
  ADD COLUMN IF NOT EXISTS voice_recording_name TEXT;

COMMENT ON COLUMN leads.voice_recording_url  IS 'Path to uploaded voice recording file for this lead';
COMMENT ON COLUMN leads.voice_recording_name IS 'Original filename of the voice recording';
