-- ============================================================
-- Migration 021 — Site Visit Re-visits + Lead Closures
-- ============================================================

-- ─── 1. SITE_REVISITS ────────────────────────────────────────────────────────
-- A re-visit is a follow-up visit linked to an original site_visit.
-- Shares the same lead, project and status values as a site_visit.

CREATE TABLE IF NOT EXISTS site_revisits (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  original_visit_id   UUID NOT NULL REFERENCES site_visits(id) ON DELETE CASCADE,
  lead_id             UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  project_id          UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  visit_date          DATE NOT NULL,
  visit_time          VARCHAR(10) NOT NULL,           -- e.g. "14:30"
  assigned_to         UUID REFERENCES users(id) ON DELETE SET NULL,
  status              VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled','done','cancelled','rescheduled','no_show')),
  transport_arranged  BOOLEAN DEFAULT false,
  reason              TEXT,                           -- why a revisit was needed
  notes               TEXT,
  created_by          UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_site_revisits_original  ON site_revisits(original_visit_id);
CREATE INDEX IF NOT EXISTS idx_site_revisits_lead      ON site_revisits(lead_id);
CREATE INDEX IF NOT EXISTS idx_site_revisits_date      ON site_revisits(visit_date DESC);

-- Feedback for re-visits (same shape as site_visit_feedback)
CREATE TABLE IF NOT EXISTS site_revisit_feedback (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  revisit_id       UUID NOT NULL UNIQUE REFERENCES site_revisits(id) ON DELETE CASCADE,
  rating           INTEGER CHECK (rating BETWEEN 1 AND 5),
  client_reaction  VARCHAR(30) NOT NULL
                     CHECK (client_reaction IN ('very_positive','positive','neutral','negative','not_interested')),
  interested_in    TEXT,
  next_step        VARCHAR(30) NOT NULL
                     CHECK (next_step IN ('negotiation','follow_up','send_proposal','booked','lost','another_revisit')),
  remarks          TEXT,
  submitted_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE site_revisits          IS 'Follow-up site visits linked to an original visit';
COMMENT ON TABLE site_revisit_feedback  IS 'Feedback submitted after a revisit is completed';

-- ─── 2. LEAD_CLOSURES ────────────────────────────────────────────────────────
-- Captures all booking/closure details when a lead converts to a customer.
-- Created when a lead is booked (status = booked).

CREATE TABLE IF NOT EXISTS lead_closures (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id                 UUID NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
  project_id              UUID REFERENCES projects(id) ON DELETE SET NULL,
  site_visit_id           UUID REFERENCES site_visits(id) ON DELETE SET NULL,  -- optional link to the visit that led to closure

  -- Booking details
  booking_date            DATE NOT NULL,
  unit_number             VARCHAR(100),               -- flat/unit no. e.g. "B-1204"
  tower_block             VARCHAR(100),               -- tower/block e.g. "Tower B"
  floor_number            INTEGER,
  unit_type               VARCHAR(50),                -- e.g. "2BHK", "3BHK"
  carpet_area_sqft        NUMERIC(10,2),
  super_area_sqft         NUMERIC(10,2),

  -- Financials
  agreed_price            NUMERIC(15,2),              -- final agreed sale price
  booking_amount          NUMERIC(15,2),              -- initial token/booking amount paid
  payment_plan            VARCHAR(100),               -- e.g. "Construction Linked", "Down Payment"
  loan_required           BOOLEAN DEFAULT false,
  loan_bank               VARCHAR(200),               -- bank name if loan arranged

  -- Commission
  commission_amount       NUMERIC(15,2),              -- commission earned on this deal
  commission_percent      NUMERIC(5,2),               -- % of agreed price
  commission_paid         BOOLEAN DEFAULT false,
  commission_paid_date    DATE,

  -- Closure meta
  closed_by               UUID REFERENCES users(id) ON DELETE SET NULL,   -- sales exec who closed
  closed_by_manager       UUID REFERENCES users(id) ON DELETE SET NULL,   -- their manager
  closure_notes           TEXT,

  status                  VARCHAR(20) NOT NULL DEFAULT 'confirmed'
                            CHECK (status IN ('confirmed','cancelled','on_hold')),

  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_closures_lead    ON lead_closures(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_closures_project ON lead_closures(project_id);
CREATE INDEX IF NOT EXISTS idx_lead_closures_date    ON lead_closures(booking_date DESC);
CREATE INDEX IF NOT EXISTS idx_lead_closures_closed  ON lead_closures(closed_by);

COMMENT ON TABLE  lead_closures                  IS 'Booking/closure records when a lead converts to a customer';
COMMENT ON COLUMN lead_closures.agreed_price     IS 'Final negotiated sale price in INR';
COMMENT ON COLUMN lead_closures.booking_amount   IS 'Initial token/booking amount paid by client';
COMMENT ON COLUMN lead_closures.commission_amount IS 'Commission earned by the sales team on this deal';
