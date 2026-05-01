-- ============================================================
-- Next One Realty CRM — Migration 009
-- Attendance module
-- ============================================================

-- ─── Attendance records ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Date & time
  date             DATE NOT NULL DEFAULT CURRENT_DATE,
  check_in_time    TIMESTAMPTZ,
  check_out_time   TIMESTAMPTZ,
  working_hours    NUMERIC(5, 2),          -- e.g. 8.50 = 8h 30m

  -- Status
  status           VARCHAR(20) NOT NULL DEFAULT 'absent'
                   CHECK (status IN ('present','absent','on_leave','half_day','late')),

  leave_type       VARCHAR(20)
                   CHECK (leave_type IN ('full_day','half_day','sick','casual','unpaid') OR leave_type IS NULL),

  -- Selfie photo (local storage path)
  checkin_photo    TEXT,                   -- relative path: uploads/attendance/checkin/<filename>
  checkout_photo   TEXT,                   -- relative path: uploads/attendance/checkout/<filename>

  -- Geo-location (captured, not validated)
  checkin_latitude   NUMERIC(10, 7),
  checkin_longitude  NUMERIC(10, 7),
  checkin_address    TEXT,                 -- reverse-geocoded label from mobile (optional)
  checkout_latitude  NUMERIC(10, 7),
  checkout_longitude NUMERIC(10, 7),
  checkout_address   TEXT,

  -- Device / network info
  checkin_ip         VARCHAR(64),
  checkin_device     TEXT,                 -- user-agent or device model from mobile
  checkout_ip        VARCHAR(64),
  checkout_device    TEXT,

  -- Manual override
  is_manual_entry    BOOLEAN DEFAULT FALSE,
  manual_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  manual_reason      TEXT,

  -- Leave / absence note
  reason             TEXT,
  notes              TEXT,

  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW(),

  -- One record per user per day
  CONSTRAINT uq_attendance_user_date UNIQUE (user_id, date)
);

-- ─── Indexes ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_attendance_user_id    ON attendance(user_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date       ON attendance(date DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_status     ON attendance(status);
CREATE INDEX IF NOT EXISTS idx_attendance_user_date  ON attendance(user_id, date DESC);

-- ─── Auto-update updated_at ───────────────────────────────────
CREATE OR REPLACE FUNCTION update_attendance_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_attendance_updated_at
  BEFORE UPDATE ON attendance
  FOR EACH ROW EXECUTE FUNCTION update_attendance_updated_at();

-- ─── Office config (used for "late" threshold) ────────────────
-- Stored in your existing system_config table if available,
-- otherwise insert these defaults:
INSERT INTO system_config (key, value, description)
VALUES
  ('office_checkin_start', '09:00', 'Office check-in start time (HH:MM 24h)'),
  ('office_checkin_late',  '09:30', 'Considered late if check-in after this time (HH:MM 24h)'),
  ('office_checkout_time', '18:00', 'Standard office end time (HH:MM 24h)')
ON CONFLICT (key) DO NOTHING;