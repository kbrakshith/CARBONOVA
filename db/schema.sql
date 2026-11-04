-- CARBONOVA PostgreSQL target schema (the prototype stores the same shapes as JSON documents in data/orgs/).
-- Goals taken from the technical audit: tenant isolation, evidence lineage, duplicate and overlap prevention,
-- factor versioning, immutable runs and reports, hash-chained audit.

CREATE TABLE organisation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name       text NOT NULL,
  industry         text NOT NULL,                       -- key into the industry profile catalogue
  consolidation    text NOT NULL CHECK (consolidation IN ('operational_control','financial_control','equity_share')),
  revenue_inr      numeric(18,2) CHECK (revenue_inr >= 0),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE facility (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisation(id),
  name             text NOT NULL,
  state            text,
  rainfall_mm      integer CHECK (rainfall_mm >= 0)     -- landfill decay-rate class
);

CREATE TABLE app_user (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisation(id),
  email            text NOT NULL UNIQUE,
  role             text NOT NULL CHECK (role IN ('owner','preparer','reviewer','buyer_viewer'))
);

CREATE TABLE evidence (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisation(id),
  sha256           char(64) NOT NULL,
  original_name    text NOT NULL,
  storage_key      text NOT NULL,                       -- object storage, encrypted at rest
  uploaded_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, sha256)                      -- re-importing the same bill cannot double count
);

CREATE TABLE extraction (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id      uuid NOT NULL REFERENCES evidence(id),
  field            text NOT NULL,                       -- e.g. 'kWh', 'period_start'
  extracted_value  text,
  confidence       numeric(4,3) CHECK (confidence BETWEEN 0 AND 1),
  page_ref         text,
  confirmed_value  text,
  confirmed_by     uuid REFERENCES app_user(id),
  confirmed_at     timestamptz
);

CREATE TABLE emission_factor (
  id               text PRIMARY KEY,                    -- e.g. EF-IN-GRID-CEA-V20
  kind             text NOT NULL,
  activity         text NOT NULL,
  geography        text NOT NULL,
  unit             text NOT NULL,
  gas_basis        text NOT NULL CHECK (gas_basis IN ('CO2','individual_gas','CO2e')),
  values           jsonb NOT NULL,
  source_document  text NOT NULL,
  source_table     text NOT NULL,
  published        text,
  valid_from       date NOT NULL,
  valid_to         date,
  status           text NOT NULL CHECK (status IN ('provisional','validated','retired')),
  reviewer         text,
  reviewed_on      date,
  CHECK (status <> 'validated' OR (reviewer IS NOT NULL AND reviewed_on IS NOT NULL))
);

CREATE TABLE activity (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisation(id),
  facility_id      uuid NOT NULL REFERENCES facility(id),
  type             text NOT NULL CHECK (type IN ('electricity','fuel','refrigerant','process_emission')),
  stream_key       text NOT NULL,                       -- meter id / fuel+use+ownership: scopes overlap checks
  period           daterange NOT NULL,
  payload          jsonb NOT NULL,
  data_quality     text NOT NULL CHECK (data_quality IN ('measured','estimated')),
  evidence_id      uuid REFERENCES evidence(id),
  voided_reason    text,                                -- records are never deleted
  EXCLUDE USING gist (organisation_id WITH =, facility_id WITH =, type WITH =, stream_key WITH =, period WITH &&)
    WHERE (voided_reason IS NULL)                       -- no overlapping periods for the same meter/fuel stream
);

CREATE TABLE waste_stage_record (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisation(id),
  reporting_fy     text NOT NULL,
  stage_id         text NOT NULL,
  stream_id        text NOT NULL,
  waste_class      text NOT NULL,
  tonnes           numeric(18,4) CHECK (tonnes >= 0),   -- NULL = measurement required, never silently 0
  basis            text NOT NULL CHECK (basis IN ('measured','estimated_benchmark','measurement_required')),
  route            text NOT NULL,
  location         text NOT NULL CHECK (location IN ('onsite','offsite')),
  facility_auth_no text,                                -- SPCB authorisation for hazardous routes
  manifest_evidence uuid REFERENCES evidence(id)
);

CREATE TABLE calculation_run (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisation(id),
  reporting_fy     text NOT NULL,
  input_snapshot   jsonb NOT NULL,                      -- immutable
  manifest         jsonb NOT NULL,                      -- engine, formula versions, GWP set, factor ids + register hash
  result_hash      char(64) NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE report (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL REFERENCES organisation(id),
  run_id           uuid NOT NULL REFERENCES calculation_run(id),
  version          integer NOT NULL,
  status           text NOT NULL CHECK (status IN ('draft','self_declared','internally_reviewed','externally_assured')),
  issued_by        text,
  html_sha256      char(64) NOT NULL,
  storage_key      text NOT NULL,
  issued_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, version)
);

CREATE TABLE audit_event (
  organisation_id  uuid NOT NULL REFERENCES organisation(id),
  seq              bigint NOT NULL,
  at               timestamptz NOT NULL DEFAULT now(),
  actor            text NOT NULL,
  action           text NOT NULL,
  detail           jsonb NOT NULL DEFAULT '{}',
  prev_hash        char(64) NOT NULL,
  hash             char(64) NOT NULL,
  PRIMARY KEY (organisation_id, seq)
);

-- Append-only: no UPDATE/DELETE on runs, reports or audit events.
CREATE RULE calculation_run_no_update AS ON UPDATE TO calculation_run DO INSTEAD NOTHING;
CREATE RULE report_no_update          AS ON UPDATE TO report           DO INSTEAD NOTHING;
CREATE RULE audit_no_update           AS ON UPDATE TO audit_event      DO INSTEAD NOTHING;
CREATE RULE audit_no_delete           AS ON DELETE TO audit_event      DO INSTEAD NOTHING;

-- Row-level security: every tenant table is filtered by app.organisation_id set per request.
-- ALTER TABLE activity ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY tenant ON activity USING (organisation_id = current_setting('app.organisation_id')::uuid);
-- (repeat for evidence, waste_stage_record, calculation_run, report, audit_event, facility, app_user)
-- The EXCLUDE constraint needs: CREATE EXTENSION btree_gist;
