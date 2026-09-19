CREATE TABLE automation_policies (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  enabled boolean NOT NULL,
  mode text NOT NULL CHECK (
    mode IN ('SUGGEST_ONLY','REQUIRE_APPROVAL','AUTO_EXECUTE_LOW_RISK')
  ),
  allowed_action_intents text[] NOT NULL,
  max_risk_class text NOT NULL CHECK (max_risk_class IN ('LOW','MEDIUM','HIGH')),
  max_amount numeric,
  max_quantity numeric,
  allowed_identity_sources text[] NOT NULL,
  allowed_actor_roles text[],
  approval_roles text[],
  allowed_target_entity_types text[],
  allowed_target_entity_ids text[],
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  created_by text NOT NULL,
  updated_by text NOT NULL,
  UNIQUE (account_id, id),
  UNIQUE (account_id)
);

CREATE TABLE automation_policy_revisions (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  policy_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  snapshot jsonb NOT NULL,
  changed_at timestamptz NOT NULL,
  changed_by text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('CREATED','UPDATED')),
  UNIQUE (account_id, id),
  UNIQUE (account_id, policy_id, version),
  CONSTRAINT automation_policy_revision_policy_fk
    FOREIGN KEY (account_id, policy_id)
    REFERENCES automation_policies(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX automation_policy_revisions_account_changed_idx
  ON automation_policy_revisions(account_id, changed_at DESC);

CREATE TABLE automation_approvals (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  proposal_id text NOT NULL,
  policy_id text NOT NULL,
  policy_version integer NOT NULL CHECK (policy_version > 0),
  status text NOT NULL CHECK (
    status IN ('PENDING','APPROVED','REJECTED','CANCELLED','EXPIRED')
  ),
  requested_by text NOT NULL,
  requested_by_role text NOT NULL,
  eligible_roles text[] NOT NULL,
  decision_reason_codes text[] NOT NULL,
  decision_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolved_by text,
  resolved_by_role text,
  resolution_note text,
  UNIQUE (account_id, id),
  UNIQUE (account_id, proposal_id, policy_id, policy_version),
  CONSTRAINT automation_approval_proposal_fk
    FOREIGN KEY (account_id, proposal_id)
    REFERENCES action_proposals(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT automation_approval_policy_revision_fk
    FOREIGN KEY (account_id, policy_id, policy_version)
    REFERENCES automation_policy_revisions(account_id, policy_id, version)
);

CREATE INDEX automation_approvals_account_status_idx
  ON automation_approvals(account_id, status, requested_at DESC);

CREATE TABLE automation_controls (
  account_id text PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version >= 0),
  emergency_disabled boolean NOT NULL,
  reason text,
  updated_at timestamptz NOT NULL,
  updated_by text NOT NULL
);

CREATE TABLE automation_control_revisions (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  snapshot jsonb NOT NULL,
  changed_at timestamptz NOT NULL,
  changed_by text NOT NULL,
  UNIQUE (account_id, id),
  UNIQUE (account_id, version)
);

CREATE INDEX automation_control_revisions_account_changed_idx
  ON automation_control_revisions(account_id, changed_at DESC);

CREATE TABLE automation_runs (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  proposal_id text NOT NULL,
  status text NOT NULL CHECK (
    status IN ('RUNNING','SUCCEEDED','BLOCKED','FAILED','COMPENSATED','RECOVERY_REQUIRED')
  ),
  attempt_count integer NOT NULL CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  actor text NOT NULL,
  actor_role text NOT NULL,
  policy_id text,
  policy_version integer,
  execution_id text,
  failure_category text CHECK (
    failure_category IS NULL OR
    failure_category IN ('POLICY','KILL_SWITCH','STALE_STATE','VALIDATION','TECHNICAL','UNSUPPORTED')
  ),
  retryable boolean,
  last_error text,
  started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  compensation_proposal_id text,
  compensation_execution_id text,
  feedback text CHECK (
    feedback IS NULL OR
    feedback IN ('CORRECT','FALSE_TRIGGER','NEEDS_CORRECTION')
  ),
  feedback_at timestamptz,
  feedback_by text,
  feedback_note text,
  UNIQUE (account_id, id),
  CONSTRAINT automation_run_proposal_fk
    FOREIGN KEY (account_id, proposal_id)
    REFERENCES action_proposals(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT automation_run_policy_revision_fk
    FOREIGN KEY (account_id, policy_id, policy_version)
    REFERENCES automation_policy_revisions(account_id, policy_id, version),
  CONSTRAINT automation_run_execution_fk
    FOREIGN KEY (account_id, execution_id)
    REFERENCES action_executions(account_id, id),
  CONSTRAINT automation_run_compensation_proposal_fk
    FOREIGN KEY (account_id, compensation_proposal_id)
    REFERENCES action_proposals(account_id, id),
  CONSTRAINT automation_run_compensation_execution_fk
    FOREIGN KEY (account_id, compensation_execution_id)
    REFERENCES action_executions(account_id, id)
);

CREATE INDEX automation_runs_account_started_idx
  ON automation_runs(account_id, started_at DESC);

CREATE INDEX automation_runs_account_status_idx
  ON automation_runs(account_id, status, started_at DESC);

CREATE TABLE platform_domain_pack_installations (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  pack_id text NOT NULL,
  pack_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','REMOVED')),
  installed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, id)
);

CREATE UNIQUE INDEX platform_domain_pack_one_active_idx
  ON platform_domain_pack_installations(account_id, pack_id)
  WHERE status = 'ACTIVE';

CREATE INDEX platform_domain_pack_account_updated_idx
  ON platform_domain_pack_installations(account_id, updated_at DESC);

ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_account_id_id_unique
  UNIQUE (account_id, id);

CREATE TABLE platform_tool_invocation_audit (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tool_id text NOT NULL,
  tool_version text NOT NULL,
  request_id text NOT NULL,
  api_key_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('STARTED','SUCCEEDED','FAILED')),
  input_hash char(64) NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  error_code text,
  error_message text,
  UNIQUE (account_id, id),
  CONSTRAINT platform_tool_invocation_api_key_fk
    FOREIGN KEY (account_id, api_key_id)
    REFERENCES api_keys(account_id, id)
);

CREATE INDEX platform_tool_invocation_account_started_idx
  ON platform_tool_invocation_audit(account_id, started_at DESC);

CREATE INDEX platform_tool_invocation_key_started_idx
  ON platform_tool_invocation_audit(api_key_id, started_at DESC);
