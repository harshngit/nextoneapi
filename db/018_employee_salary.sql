-- ============================================================
-- Migration 018 — Employee Salary System
-- ============================================================

-- ─── employee_salaries table ─────────────────────────────────
-- Stores the monthly salary amount set by admin per employee.
-- One active record per employee. History is preserved on update.
CREATE TABLE IF NOT EXISTS employee_salaries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  monthly_salary NUMERIC(12, 2) NOT NULL CHECK (monthly_salary >= 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  set_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emp_salaries_user_id       ON employee_salaries(user_id);
CREATE INDEX IF NOT EXISTS idx_emp_salaries_effective_from ON employee_salaries(effective_from DESC);

COMMENT ON TABLE  employee_salaries                    IS 'Monthly salary records per employee, set by admin';
COMMENT ON COLUMN employee_salaries.monthly_salary     IS 'Gross monthly salary in INR';
COMMENT ON COLUMN employee_salaries.effective_from     IS 'Date from which this salary is active';

-- ─── salary_slips table ──────────────────────────────────────
-- Computed/generated monthly salary slips per employee.
-- Admin generates a slip for a given month/year.
CREATE TABLE IF NOT EXISTS salary_slips (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month               SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  year                SMALLINT NOT NULL CHECK (year >= 2020),
  monthly_salary      NUMERIC(12, 2) NOT NULL,   -- base salary used for this month
  working_days        INTEGER NOT NULL,           -- total working days in the month (excl. weekends)
  present_days        NUMERIC(5, 2) NOT NULL,     -- days counted as present (present + late + 0.5*half_day)
  absent_days         NUMERIC(5, 2) NOT NULL,
  leave_days          NUMERIC(5, 2) NOT NULL,
  per_day_salary      NUMERIC(12, 2) NOT NULL,    -- monthly_salary / working_days
  earned_salary       NUMERIC(12, 2) NOT NULL,    -- per_day_salary * present_days
  deductions          NUMERIC(12, 2) DEFAULT 0,   -- any manual deductions
  final_salary        NUMERIC(12, 2) NOT NULL,    -- earned_salary - deductions
  generated_by        UUID REFERENCES users(id) ON DELETE SET NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),

  CONSTRAINT uq_salary_slip_user_month_year UNIQUE (user_id, month, year)
);

CREATE INDEX IF NOT EXISTS idx_salary_slips_user_id  ON salary_slips(user_id);
CREATE INDEX IF NOT EXISTS idx_salary_slips_month_year ON salary_slips(year DESC, month DESC);

COMMENT ON TABLE salary_slips IS 'Monthly computed salary slips per employee';
