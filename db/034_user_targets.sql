-- 034_user_targets.sql — Next One Realty CRM
--
-- Monthly performance targets, per user.
-- Default target (applied when no row exists for a user/month): 15 site visits + 1 closure.
-- Achievement / "remaining" is NOT stored here — it's computed live from
-- site_visits (status = 'done') and lead_closures (status != 'cancelled'),
-- so a booking automatically reduces the remaining target with no extra writes.

CREATE TABLE IF NOT EXISTS user_targets (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_month        DATE NOT NULL,              -- always normalized to the 1st of the month
  site_visit_target   INTEGER NOT NULL DEFAULT 15 CHECK (site_visit_target >= 0),
  closure_target      INTEGER NOT NULL DEFAULT 1  CHECK (closure_target >= 0),
  set_by              UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, target_month)
);

CREATE INDEX IF NOT EXISTS idx_user_targets_user  ON user_targets(user_id);
CREATE INDEX IF NOT EXISTS idx_user_targets_month ON user_targets(target_month);
