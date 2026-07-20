-- Adds the fields needed to render a salary slip PDF.
-- incentive_amount / total_payout already exist (migration 025) but were
-- never actually populated by any code path until now.
ALTER TABLE salary_slips
  ADD COLUMN IF NOT EXISTS payment_mode VARCHAR(50) DEFAULT 'Bank Transfer',
  ADD COLUMN IF NOT EXISTS pay_date     DATE;
