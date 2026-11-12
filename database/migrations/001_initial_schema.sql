CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL UNIQUE,
  code VARCHAR(20) UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE lgas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_id UUID NOT NULL REFERENCES states(id),
  name VARCHAR(120) NOT NULL,
  code VARCHAR(30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (state_id, name),
  UNIQUE (state_id, code)
);

CREATE TABLE facilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lga_id UUID NOT NULL REFERENCES lgas(id),
  name VARCHAR(180) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  address TEXT,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  facility_type VARCHAR(40) NOT NULL DEFAULT 'primary_health_centre',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(30) NOT NULL CHECK (role IN ('health_worker','lga_officer','state_admin','system_admin')),
  designation VARCHAR(50),
  can_respond_emergency BOOLEAN NOT NULL DEFAULT FALSE,
  phone VARCHAR(30),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE facility_users (
  facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (facility_id, user_id)
);

CREATE TABLE user_lga_access (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lga_id UUID NOT NULL REFERENCES lgas(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, lga_id)
);

CREATE TABLE inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(180) NOT NULL,
  category VARCHAR(100) NOT NULL,
  unit VARCHAR(50) NOT NULL,
  default_minimum_stock NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (default_minimum_stock >= 0),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, unit)
);

CREATE TABLE stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  item_id UUID NOT NULL REFERENCES inventory_items(id),
  user_id UUID NOT NULL REFERENCES users(id),
  movement_type VARCHAR(30) NOT NULL CHECK (movement_type IN ('RECEIVED','DISPENSED','ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT','EXPIRED','DAMAGED')),
  quantity_delta NUMERIC(12,2) NOT NULL CHECK (quantity_delta <> 0),
  batch_number VARCHAR(100),
  expiry_date DATE,
  note TEXT,
  operation_id UUID NOT NULL UNIQUE,
  device_occurred_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX stock_movements_facility_item_idx ON stock_movements(facility_id, item_id, created_at DESC);

CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_code VARCHAR(30) NOT NULL UNIQUE,
  origin_facility_id UUID NOT NULL REFERENCES facilities(id),
  destination_facility_id UUID NOT NULL REFERENCES facilities(id),
  created_by UUID NOT NULL REFERENCES users(id),
  patient_age_years SMALLINT CHECK (patient_age_years BETWEEN 0 AND 120),
  patient_sex VARCHAR(12) CHECK (patient_sex IN ('female','male','unknown')),
  reason_code VARCHAR(100) NOT NULL,
  urgency VARCHAR(20) NOT NULL DEFAULT 'routine' CHECK (urgency IN ('routine','urgent','emergency')),
  status VARCHAR(20) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','acknowledged','arrived','completed','rejected','cancelled')),
  operation_id UUID NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (origin_facility_id <> destination_facility_id)
);
CREATE INDEX referrals_origin_created_idx ON referrals(origin_facility_id, created_at DESC);
CREATE INDEX referrals_destination_status_idx ON referrals(destination_facility_id, status);

CREATE TABLE referral_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id UUID NOT NULL REFERENCES referrals(id) ON DELETE CASCADE,
  event_type VARCHAR(30) NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sync_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id),
  facility_id UUID NOT NULL REFERENCES facilities(id),
  operation_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending','processed','failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(80) NOT NULL,
  resource_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX audit_logs_actor_created_idx ON audit_logs(actor_user_id, created_at DESC);

-- Keep all application tables inaccessible through the public Data API by default.
-- The PHC Link Express API connects server-side using DATABASE_URL.
ALTER TABLE states ENABLE ROW LEVEL SECURITY;
ALTER TABLE lgas ENABLE ROW LEVEL SECURITY;
ALTER TABLE facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE facility_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_lga_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
