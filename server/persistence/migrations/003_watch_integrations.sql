CREATE TABLE watch_rules (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  status text NOT NULL
    CHECK (status IN ('ACTIVE','PAUSED','INVALID','ARCHIVED')),
  origin text NOT NULL
    CHECK (origin IN ('MANUAL','NATURAL_LANGUAGE','INSIGHT','SYSTEM')),
  version integer NOT NULL CHECK (version > 0),
  condition jsonb NOT NULL,
  evaluation_mode text NOT NULL
    CHECK (evaluation_mode IN ('MANUAL','INTERVAL','EVENT')),
  interval_minutes integer CHECK (
    interval_minutes IS NULL OR interval_minutes > 0
  ),
  current_state text NOT NULL
    CHECK (current_state IN ('UNKNOWN','FALSE','TRUE','ERROR')),
  last_evaluation_at timestamptz,
  last_triggered_at timestamptz,
  next_evaluation_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, id)
);

CREATE INDEX watch_rules_due_idx
  ON watch_rules(account_id, status, evaluation_mode, next_evaluation_at)
  WHERE status = 'ACTIVE' AND evaluation_mode = 'INTERVAL';

CREATE TABLE watch_drafts (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  instruction text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('PROPOSED','NEEDS_INPUT','SAVED','CANCELLED','INVALID')),
  parser_source text NOT NULL
    CHECK (parser_source IN ('DETERMINISTIC','LLM_ASSISTED')),
  proposed_name text NOT NULL,
  parsed_request jsonb,
  condition jsonb,
  candidates jsonb,
  needs_input_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  saved_rule_id text,
  UNIQUE (account_id, id),
  CONSTRAINT watch_draft_saved_rule_fk
    FOREIGN KEY (account_id, saved_rule_id)
    REFERENCES watch_rules(account_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX watch_drafts_account_created_idx
  ON watch_drafts(account_id, created_at DESC);

CREATE TABLE watch_evaluations (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  watch_rule_id text NOT NULL,
  rule_version integer NOT NULL CHECK (rule_version > 0),
  status text NOT NULL CHECK (status IN ('COMPLETED','FAILED')),
  condition_matched boolean,
  observed_value double precision,
  comparison_operator text NOT NULL
    CHECK (comparison_operator IN ('GT','GTE','LT','LTE','EQ','NEQ')),
  threshold double precision NOT NULL,
  previous_condition_state text NOT NULL
    CHECK (previous_condition_state IN ('UNKNOWN','FALSE','TRUE','ERROR')),
  next_condition_state text NOT NULL
    CHECK (next_condition_state IN ('UNKNOWN','FALSE','TRUE','ERROR')),
  evidence jsonb,
  evaluated_at timestamptz NOT NULL,
  error text,
  UNIQUE (account_id, id),
  CONSTRAINT watch_evaluation_rule_fk
    FOREIGN KEY (account_id, watch_rule_id)
    REFERENCES watch_rules(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX watch_evaluations_rule_time_idx
  ON watch_evaluations(account_id, watch_rule_id, evaluated_at DESC);

CREATE TABLE watch_alerts (
  id text PRIMARY KEY,
  episode_key text NOT NULL,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  watch_rule_id text NOT NULL,
  rule_version integer NOT NULL CHECK (rule_version > 0),
  status text NOT NULL
    CHECK (status IN ('OPEN','ACKNOWLEDGED','SNOOZED','RESOLVED')),
  title text NOT NULL,
  summary text NOT NULL,
  first_triggered_at timestamptz NOT NULL,
  last_triggered_at timestamptz NOT NULL,
  occurrence_count integer NOT NULL CHECK (occurrence_count > 0),
  evaluation_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_evaluation_id text NOT NULL,
  evidence jsonb NOT NULL,
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolution_reason text CHECK (
    resolution_reason IS NULL OR
    resolution_reason IN ('CONDITION_CLEARED','USER_RESOLVED')
  ),
  snoozed_until timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, id),
  UNIQUE (account_id, episode_key),
  CONSTRAINT watch_alert_rule_fk
    FOREIGN KEY (account_id, watch_rule_id)
    REFERENCES watch_rules(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT watch_alert_last_evaluation_fk
    FOREIGN KEY (account_id, last_evaluation_id)
    REFERENCES watch_evaluations(account_id, id)
);

CREATE INDEX watch_alerts_rule_status_idx
  ON watch_alerts(account_id, watch_rule_id, status, last_triggered_at DESC);

CREATE TABLE watch_jobs (
  id text PRIMARY KEY,
  fingerprint text NOT NULL,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  watch_rule_id text NOT NULL,
  rule_version integer NOT NULL CHECK (rule_version > 0),
  scheduled_for timestamptz NOT NULL,
  status text NOT NULL
    CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED','SKIPPED')),
  attempt_count integer NOT NULL CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  next_attempt_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  evaluation_id text,
  last_error text,
  skip_reason text,
  UNIQUE (account_id, id),
  UNIQUE (account_id, fingerprint),
  UNIQUE (account_id, watch_rule_id, rule_version, scheduled_for),
  CONSTRAINT watch_job_rule_fk
    FOREIGN KEY (account_id, watch_rule_id)
    REFERENCES watch_rules(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT watch_job_evaluation_fk
    FOREIGN KEY (account_id, evaluation_id)
    REFERENCES watch_evaluations(account_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX watch_jobs_ready_idx
  ON watch_jobs(status, next_attempt_at, scheduled_for)
  WHERE status = 'PENDING';

CREATE TABLE integration_connections (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('ACTIVE','PAUSED','REVOKED','ERROR')),
  capabilities jsonb NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  credential_ref text,
  cursor text,
  attention_reason text CHECK (
    attention_reason IS NULL OR
    attention_reason IN (
      'REAUTHORIZE','PERMISSION_LOST','CURSOR_RESET_REQUIRED','SYNC_FAILED'
    )
  ),
  last_failure_category text CHECK (
    last_failure_category IS NULL OR
    last_failure_category IN (
      'AUTHORIZATION','PERMISSION','RATE_LIMIT','TRANSIENT','CURSOR_INVALID',
      'DATA_INVALID','UNSUPPORTED','CONFLICT','UNKNOWN'
    )
  ),
  consecutive_failure_count integer
    CHECK (consecutive_failure_count IS NULL OR consecutive_failure_count >= 0),
  next_retry_at timestamptz,
  sync_lease_id text,
  sync_lease_expires_at timestamptz,
  last_sync_at timestamptz,
  last_successful_sync_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, id),
  UNIQUE (account_id, id, provider)
);

CREATE INDEX integration_connections_account_status_idx
  ON integration_connections(account_id, status, updated_at DESC);

CREATE TABLE integration_sync_runs (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
  cursor_before text,
  cursor_after text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  attempt_count integer NOT NULL CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  retryable boolean,
  failure_category text CHECK (
    failure_category IS NULL OR
    failure_category IN (
      'AUTHORIZATION','PERMISSION','RATE_LIMIT','TRANSIENT','CURSOR_INVALID',
      'DATA_INVALID','UNSUPPORTED','CONFLICT','UNKNOWN'
    )
  ),
  next_retry_at timestamptz,
  processed_count integer NOT NULL CHECK (processed_count >= 0),
  imported_count integer NOT NULL CHECK (imported_count >= 0),
  skipped_count integer NOT NULL CHECK (skipped_count >= 0),
  tombstone_count integer NOT NULL CHECK (tombstone_count >= 0),
  failed_count integer NOT NULL CHECK (failed_count >= 0),
  record_results jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  UNIQUE (account_id, id),
  CONSTRAINT integration_sync_run_connection_fk
    FOREIGN KEY (account_id, connection_id, provider)
    REFERENCES integration_connections(account_id, id, provider)
    ON DELETE CASCADE
);

CREATE INDEX integration_sync_runs_connection_time_idx
  ON integration_sync_runs(account_id, connection_id, started_at DESC);

CREATE TABLE integration_external_imports (
  id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('INGESTED','READY','TOMBSTONE')),
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id text NOT NULL,
  provider text NOT NULL,
  external_id text NOT NULL,
  external_version text NOT NULL,
  external_name text NOT NULL,
  resource_kind text NOT NULL
    CHECK (resource_kind IN ('FILE','SPREADSHEET','DOCUMENT','MESSAGE','RECORD')),
  internal_kind text NOT NULL
    CHECK (internal_kind IN ('DATASET','DOCUMENT','TOMBSTONE')),
  internal_id text,
  internal_version_id text,
  knowledge_projection_run_id text,
  last_error text,
  imported_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  provenance jsonb NOT NULL,
  UNIQUE (account_id, id),
  UNIQUE (account_id, connection_id, external_id, external_version),
  CONSTRAINT integration_external_import_connection_fk
    FOREIGN KEY (account_id, connection_id, provider)
    REFERENCES integration_connections(account_id, id, provider)
    ON DELETE CASCADE,
  CONSTRAINT integration_external_import_projection_fk
    FOREIGN KEY (account_id, knowledge_projection_run_id)
    REFERENCES knowledge_projection_runs(account_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX integration_external_import_lookup_idx
  ON integration_external_imports(
    account_id,
    connection_id,
    external_id,
    imported_at DESC
  );
