-- Employee commission tracking — linked to a lead + project.
CREATE TABLE IF NOT EXISTS employee_commissions (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lead_id               UUID        NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  project_id            UUID        REFERENCES projects(id) ON DELETE SET NULL,
  project_name_text     TEXT,
  commission_amount     NUMERIC(12,2),
  commission_percentage NUMERIC(5,2),
  notes                 TEXT,
  paid                  BOOLEAN     DEFAULT false,
  paid_date             DATE,
  created_by            UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_commissions_user    ON employee_commissions(user_id);
CREATE INDEX IF NOT EXISTS idx_employee_commissions_lead    ON employee_commissions(lead_id);
CREATE INDEX IF NOT EXISTS idx_employee_commissions_project ON employee_commissions(project_id);

-- Employee advance payment tracking.
CREATE TABLE IF NOT EXISTS employee_advances (
  id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id               UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  advance_date          DATE        NOT NULL,
  amount                NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  transaction_reference VARCHAR(255),
  payment_proof_url     TEXT,
  notes                 TEXT,
  given_by              UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_advances_user ON employee_advances(user_id);
CREATE INDEX IF NOT EXISTS idx_employee_advances_date ON employee_advances(advance_date);
