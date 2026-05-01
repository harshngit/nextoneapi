-- ============================================================
-- Next One Realty CRM — Migration 009
-- Attendance module
-- Fixed: uses system_settings (existing table), not system_config
-- ============================================================

-- ─── Step 1: Add office time columns to existing system_settings ─
ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS office_checkin_start VARCHAR(5) DEFAULT '09:00',
  ADD COLUMN IF NOT EXISTS office_checkin_late  VARCHAR(5) DEFAULT '09:30',
  ADD COLUMN IF NOT EXISTS office_checkout_time VARCHAR(5) DEFAULT '18:00';

-- Update existing row with defaults
UPDATE system_settings
SET
  office_checkin_start = COALESCE(office_checkin_start, '09:00'),
  office_checkin_late  = COALESCE(office_checkin_late,  '09:30'),
  office_checkout_time = COALESCE(office_checkout_time, '18:00');

-- ─── Step 2: Create attendance table ────────────────────────
CREATE TABLE IF NOT EXISTS attendance (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Date & time
  date             DATE NOT NULL DEFAULT CURRENT_DATE,
  check_in_time    TIMESTAMPTZ,
  check_out_time   TIMESTAMPTZ,
  working_hours    NUMERIC(5, 2),

  -- Status
  status           VARCHAR(20) NOT NULL DEFAULT 'absent'
                   CHECK (status IN ('present', 'absent', 'on_leave', 'half_day', 'late')),

  leave_type       VARCHAR(20)
                   CHECK (leave_type IN ('full_day','half_day','sick','casual','unpaid') OR leave_type IS NULL),

  -- Selfie photos (local storage paths)
  checkin_photo    TEXT,
  checkout_photo   TEXT,

  -- Geo-location (captured, not validated)
  checkin_latitude    NUMERIC(10, 7),
  checkin_longitude   NUMERIC(10, 7),
  checkin_address     TEXT,
  checkout_latitude   NUMERIC(10, 7),
  checkout_longitude  NUMERIC(10, 7),
  checkout_address    TEXT,

  -- Device / network info
  checkin_ip          VARCHAR(64),
  checkin_device      TEXT,
  checkout_ip         VARCHAR(64),
  checkout_device     TEXT,

  -- Manual override
  is_manual_entry  BOOLEAN DEFAULT FALSE,
  manual_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  manual_reason    TEXT,

  reason           TEXT,
  notes            TEXT,

  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),

  -- One record per user per day
  CONSTRAINT uq_attendance_user_date UNIQUE (user_id, date)
);

-- ─── Step 3: Indexes ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_attendance_user_id   ON attendance(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date      ON attendance(date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_status    ON attendance(status);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date ON attendance(user_id, date DESC);

-- ─── Step 4: Auto-update updated_at trigger ──────────────────
CREATE OR REPLACE FUNCTION update_attendance_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_attendance_updated_at ON attendance;
CREATE TRIGGER trg_attendance_updated_at
  BEFORE UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION update_attendance_updated_at();

-- ─── Done ────────────────────────────────────────────────────
-- Office time settings are now in system_settings columns:
--   office_checkin_start  (default '09:00')
--   office_checkin_late   (default '09:30')  ← used by controller
--   office_checkout_time  (default '18:00')