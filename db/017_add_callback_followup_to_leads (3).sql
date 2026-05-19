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

-- ─── call_recordings table ────────────────────────────────────────────────────
-- Stores multiple call recordings per lead.
-- Each recording tracks the file URL, caller phone number, and a display name.
CREATE TABLE IF NOT EXISTS call_recordings (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  url          TEXT NOT NULL,
  phone_number VARCHAR(20),
  name         VARCHAR(200),
  file_size    INTEGER,
  duration_sec INTEGER,
  uploaded_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_recordings_lead_id ON call_recordings(lead_id);

COMMENT ON TABLE  call_recordings              IS 'Call recordings linked to a lead';
COMMENT ON COLUMN call_recordings.url          IS 'File path on disk e.g. /uploads/leads/voice/...';
COMMENT ON COLUMN call_recordings.phone_number IS 'Phone number of the person on the call';
COMMENT ON COLUMN call_recordings.name         IS 'Display name / label for the recording';
