-- ============================================================
-- Next One Realty CRM — Migration 039
-- Admin-defined holidays, targeted by role and/or specific user
-- ============================================================

-- ─── Step 1: Allow 'holiday' as a leave_type ──────────────────
-- Holidays reuse the existing 'leave' status on the attendance table,
-- distinguished by leave_type = 'holiday' (vs a personal leave applied by the user).
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_leave_type_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_leave_type_check
  CHECK (leave_type IN ('full_day','half_day','sick','casual','unpaid','holiday') OR leave_type IS NULL);

-- ─── Step 2: Holidays table ────────────────────────────────────
-- One row = one holiday definition for one date.
-- Targeting is explicit and additive:
--   roles      — array of role strings this holiday applies to (e.g. '{sales_executive,external_caller}').
--                Special value 'all' means every active role.
--   user_ids   — array of specific user UUIDs this holiday additionally applies to,
--                regardless of their role (e.g. one person granted an extra day off).
-- At least one of roles / user_ids must be non-empty — admin must always target someone explicitly.
CREATE TABLE IF NOT EXISTS holidays (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date        DATE NOT NULL,
  name        VARCHAR(150) NOT NULL,
  description TEXT,

  roles       TEXT[] NOT NULL DEFAULT '{}',
  user_ids    UUID[] NOT NULL DEFAULT '{}',

  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT chk_holiday_has_target CHECK (
    array_length(roles, 1) > 0 OR array_length(user_ids, 1) > 0
  )
);

CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);

-- One holiday "name" per date is fine to repeat across different role targets
-- (e.g. two separate holiday rows for the same date is allowed — different teams,
-- different reasons) — no uniqueness constraint on date alone.

-- ─── Step 3: Auto-update updated_at trigger ───────────────────
CREATE OR REPLACE FUNCTION update_holidays_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_holidays_updated_at ON holidays;
CREATE TRIGGER trg_holidays_updated_at
  BEFORE UPDATE ON holidays
  FOR EACH ROW EXECUTE FUNCTION update_holidays_updated_at();

-- ─── Done ───────────────────────────────────────────────────────
-- Usage:
--   Company-wide holiday (e.g. Diwali):  roles = '{all}', user_ids = '{}'
--   Sales-team-only holiday:             roles = '{sales_executive,external_caller,sales_manager}', user_ids = '{}'
--   One specific person's extra day off: roles = '{}', user_ids = '{<uuid>}'
--   Mixed:                               roles = '{sales_executive}', user_ids = '{<uuid-of-one-admin>}'
