-- ============================================================
-- Migration 025 — Incentives & Appraisal System
-- ============================================================

-- ─── employee_incentives ─────────────────────────────────────
-- Stores one-time or recurring incentive payouts per employee.
-- Incentives are ADDED on top of the salary slip's final_salary.
CREATE TABLE IF NOT EXISTS employee_incentives (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month         SMALLINT    NOT NULL CHECK (month BETWEEN 1 AND 12),
  year          SMALLINT    NOT NULL CHECK (year >= 2020),
  amount        NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  reason        TEXT,                         -- e.g. "Exceeded target by 120%"
  given_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_incentives_user_id    ON employee_incentives(user_id);
CREATE INDEX IF NOT EXISTS idx_incentives_month_year ON employee_incentives(year DESC, month DESC);

COMMENT ON TABLE employee_incentives IS 'Performance-based incentive payouts per employee per month';
COMMENT ON COLUMN employee_incentives.amount IS 'Incentive amount in INR added on top of earned salary';

-- ─── employee_appraisals ─────────────────────────────────────
-- Full appraisal history: stores every salary revision with
-- from_salary, to_salary, percentage change, and remarks.
-- A new record is written whenever setEmployeeSalary is called
-- as a formal appraisal (when appraisal_note is provided).
CREATE TABLE IF NOT EXISTS employee_appraisals (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_salary       NUMERIC(12,2),            -- salary before this appraisal (NULL for first)
  to_salary         NUMERIC(12,2) NOT NULL,   -- new salary after appraisal
  increment_amount  NUMERIC(12,2),            -- to_salary - from_salary
  increment_percent NUMERIC(6,2),             -- percentage hike
  effective_from    DATE        NOT NULL DEFAULT CURRENT_DATE,
  appraisal_note    TEXT,                     -- reason / performance remark
  appraised_by      UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appraisals_user_id ON employee_appraisals(user_id);
CREATE INDEX IF NOT EXISTS idx_appraisals_effective_from ON employee_appraisals(effective_from DESC);

COMMENT ON TABLE employee_appraisals IS 'Appraisal history: salary revisions with increment details';

-- ─── Patch salary_slips — add incentive_amount column ────────
-- Stores the total incentive amount included in a slip's payout.
ALTER TABLE salary_slips
  ADD COLUMN IF NOT EXISTS incentive_amount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_payout     NUMERIC(12,2);  -- final_salary + incentive_amount

COMMENT ON COLUMN salary_slips.incentive_amount IS 'Total incentives added for this month';
COMMENT ON COLUMN salary_slips.total_payout     IS 'final_salary + incentive_amount — actual take-home';
