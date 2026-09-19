CREATE TABLE company_entities (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (
    type IN (
      'CUSTOMER','PRODUCT','SUPPLIER','ORDER','INVOICE','BRANCH',
      'LOCATION','CONTRACT','PROJECT','EMPLOYEE','ORGANIZATION','OTHER'
    )
  ),
  canonical_name text NOT NULL,
  normalized_name text NOT NULL,
  identity_key text NOT NULL,
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  UNIQUE (account_id, id),
  UNIQUE (account_id, type, identity_key)
);

CREATE INDEX company_entities_account_type_idx
  ON company_entities(account_id, type, last_observed_at DESC);

CREATE TABLE company_relationships (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  subject_entity_id text NOT NULL,
  predicate text NOT NULL,
  object_entity_id text NOT NULL,
  claim_kind text NOT NULL
    CHECK (claim_kind IN ('FACT','OBSERVATION','INFERENCE')),
  authority_level text NOT NULL,
  authority_rank integer NOT NULL,
  authority_reason text NOT NULL,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  occurrence_count integer NOT NULL CHECK (occurrence_count > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, id),
  UNIQUE (account_id, fingerprint),
  CONSTRAINT company_relationship_subject_fk
    FOREIGN KEY (account_id, subject_entity_id)
    REFERENCES company_entities(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT company_relationship_object_fk
    FOREIGN KEY (account_id, object_entity_id)
    REFERENCES company_entities(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX company_relationships_account_subject_idx
  ON company_relationships(account_id, subject_entity_id, predicate);

CREATE TABLE knowledge_projection_runs (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('DATASET','DOCUMENT')),
  source_id text NOT NULL,
  source_version_id text,
  source_version_label text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  status text NOT NULL CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
  entity_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  relationship_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  claim_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  UNIQUE (account_id, id)
);

CREATE INDEX knowledge_projection_runs_source_idx
  ON knowledge_projection_runs(account_id, source_type, source_id, started_at DESC);

CREATE TABLE knowledge_claims (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  subject_entity_id text NOT NULL,
  predicate text NOT NULL,
  value jsonb NOT NULL,
  value_type text NOT NULL CHECK (
    value_type IN ('TEXT','NUMBER','BOOLEAN','DATE','NULL')
  ),
  claim_kind text NOT NULL
    CHECK (claim_kind IN ('FACT','OBSERVATION','INFERENCE')),
  authority_level text NOT NULL,
  authority_rank integer NOT NULL,
  authority_reason text NOT NULL,
  source_ref jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  valid_from timestamptz,
  valid_to timestamptz,
  is_current boolean NOT NULL,
  supersedes_claim_id text,
  created_at timestamptz NOT NULL,
  UNIQUE (account_id, id),
  UNIQUE (account_id, fingerprint),
  CONSTRAINT knowledge_claim_subject_fk
    FOREIGN KEY (account_id, subject_entity_id)
    REFERENCES company_entities(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT knowledge_claim_supersedes_fk
    FOREIGN KEY (account_id, supersedes_claim_id)
    REFERENCES knowledge_claims(account_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX knowledge_claims_effective_state_idx
  ON knowledge_claims(
    account_id,
    subject_entity_id,
    predicate,
    is_current,
    authority_rank DESC,
    observed_at DESC
  );

CREATE TABLE business_events (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  type text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_ref jsonb NOT NULL,
  occurred_at timestamptz,
  recorded_at timestamptz NOT NULL,
  projection_run_id text,
  UNIQUE (account_id, id),
  UNIQUE (account_id, fingerprint),
  CONSTRAINT business_event_projection_run_fk
    FOREIGN KEY (account_id, projection_run_id)
    REFERENCES knowledge_projection_runs(account_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE business_event_subjects (
  account_id text NOT NULL,
  event_id text NOT NULL,
  entity_id text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (account_id, event_id, entity_id),
  UNIQUE (account_id, event_id, position),
  CONSTRAINT business_event_subject_event_fk
    FOREIGN KEY (account_id, event_id)
    REFERENCES business_events(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT business_event_subject_entity_fk
    FOREIGN KEY (account_id, entity_id)
    REFERENCES company_entities(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX business_events_account_recorded_idx
  ON business_events(account_id, recorded_at DESC);

CREATE TABLE action_proposals (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  instruction text NOT NULL,
  intent text NOT NULL CHECK (
    intent IN ('RECORD_PAYMENT','RECEIVE_INVENTORY','UPDATE_STATUS','CREATE_ORDER')
  ),
  status text NOT NULL CHECK (
    status IN ('PROPOSED','NEEDS_INPUT','CONFIRMED','CANCELLED','STALE','FAILED')
  ),
  parser_source text NOT NULL CHECK (
    parser_source IN ('DETERMINISTIC','LLM_ASSISTED')
  ),
  parsed_input jsonb NOT NULL,
  target_candidates jsonb,
  needs_input_reason text,
  mutations jsonb NOT NULL DEFAULT '[]'::jsonb,
  preconditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  event_type text,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculation_summary text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  stale_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  execution_id text,
  UNIQUE (account_id, id)
);

CREATE INDEX action_proposals_account_status_idx
  ON action_proposals(account_id, status, created_at DESC);

CREATE TABLE action_proposal_targets (
  account_id text NOT NULL,
  proposal_id text NOT NULL,
  entity_id text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (account_id, proposal_id, entity_id),
  UNIQUE (account_id, proposal_id, position),
  CONSTRAINT action_proposal_target_proposal_fk
    FOREIGN KEY (account_id, proposal_id)
    REFERENCES action_proposals(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT action_proposal_target_entity_fk
    FOREIGN KEY (account_id, entity_id)
    REFERENCES company_entities(account_id, id)
);

CREATE TABLE action_executions (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  proposal_id text NOT NULL,
  intent text NOT NULL CHECK (
    intent IN ('RECORD_PAYMENT','RECEIVE_INVENTORY','UPDATE_STATUS','CREATE_ORDER')
  ),
  execution_mode text CHECK (
    execution_mode IS NULL OR
    execution_mode IN (
      'MANUAL_CONFIRMATION','AUTOMATION_POLICY','AUTOMATION_COMPENSATION'
    )
  ),
  authorized_by text,
  authorized_by_role text,
  automation_policy_id text,
  automation_policy_version integer,
  downstream_analysis_run_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  downstream_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  executed_at timestamptz NOT NULL,
  UNIQUE (account_id, id),
  UNIQUE (account_id, proposal_id),
  CONSTRAINT action_execution_proposal_fk
    FOREIGN KEY (account_id, proposal_id)
    REFERENCES action_proposals(account_id, id)
);

ALTER TABLE action_proposals
  ADD CONSTRAINT action_proposal_execution_fk
  FOREIGN KEY (account_id, execution_id)
  REFERENCES action_executions(account_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE action_execution_claims (
  account_id text NOT NULL,
  execution_id text NOT NULL,
  claim_id text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (account_id, execution_id, claim_id),
  UNIQUE (account_id, execution_id, position),
  CONSTRAINT action_execution_claim_execution_fk
    FOREIGN KEY (account_id, execution_id)
    REFERENCES action_executions(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT action_execution_claim_claim_fk
    FOREIGN KEY (account_id, claim_id)
    REFERENCES knowledge_claims(account_id, id)
);

CREATE TABLE action_execution_events (
  account_id text NOT NULL,
  execution_id text NOT NULL,
  event_id text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (account_id, execution_id, event_id),
  UNIQUE (account_id, execution_id, position),
  CONSTRAINT action_execution_event_execution_fk
    FOREIGN KEY (account_id, execution_id)
    REFERENCES action_executions(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT action_execution_event_event_fk
    FOREIGN KEY (account_id, event_id)
    REFERENCES business_events(account_id, id)
);

CREATE TABLE action_audit_entries (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  proposal_id text NOT NULL,
  action text NOT NULL CHECK (
    action IN ('PROPOSED','NEEDS_INPUT','CONFIRMED','CANCELLED','STALE','FAILED')
  ),
  occurred_at timestamptz NOT NULL,
  detail text NOT NULL,
  execution_id text,
  UNIQUE (account_id, id),
  CONSTRAINT action_audit_proposal_fk
    FOREIGN KEY (account_id, proposal_id)
    REFERENCES action_proposals(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT action_audit_execution_fk
    FOREIGN KEY (account_id, execution_id)
    REFERENCES action_executions(account_id, id)
);

CREATE INDEX action_audit_account_proposal_idx
  ON action_audit_entries(account_id, proposal_id, occurred_at DESC);
