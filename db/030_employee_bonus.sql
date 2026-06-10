-- ============================================================
-- Migration 030 — Employee Bonus Table
-- ============================================================
-- Bonus is a one-time or special payout separate from salary
-- and incentives. Examples: Diwali bonus, annual bonus, spot award.

CREATE TABLE IF NOT EXISTS employee_bonus (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  bonus_type  VARCHAR(100)  NOT NULL DEFAULT 'general',
  -- bonus_type examples: 'diwali', 'annual', 'performance', 'spot_award', 'joining', 'referral', 'general'
  month       SMALLINT      CHECK (month BETWEEN 1 AND 12),  -- optional: which month it applies to
  year        SMALLINT      CHECK (year >= 2020),             -- optional: which year it applies to
  reason      TEXT,
  paid        BOOLEAN       DEFAULT false,
  paid_date   DATE,
  given_by    UUID          REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ   DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bonus_user_id   ON employee_bonus(user_id);
CREATE INDEX IF NOT EXISTS idx_bonus_year      ON employee_bonus(year DESC, month DESC);
CREATE INDEX IF NOT EXISTS idx_bonus_paid      ON employee_bonus(paid);

COMMENT ON TABLE  employee_bonus              IS 'One-time bonus payouts: Diwali, annual, performance, spot award etc.';
COMMENT ON COLUMN employee_bonus.bonus_type   IS 'Type: diwali | annual | performance | spot_award | joining | referral | general';
COMMENT ON COLUMN employee_bonus.month        IS 'Optional: month this bonus relates to (for salary slip integration)';
COMMENT ON COLUMN employee_bonus.paid         IS 'Whether the bonus has been disbursed to the employee';
