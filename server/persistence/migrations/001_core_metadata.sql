CREATE TABLE accounts (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE workspaces (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  processing_status text NOT NULL
    CHECK (processing_status IN ('empty','processing','ready','error')),
  current_version_tag text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, id)
);

CREATE INDEX workspaces_account_updated_idx
  ON workspaces(account_id, updated_at DESC);

CREATE TABLE account_workspace_state (
  account_id text PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  active_workspace_id text,
  updated_at timestamptz NOT NULL,
  CONSTRAINT account_workspace_state_owned_workspace_fk
    FOREIGN KEY (account_id, active_workspace_id)
    REFERENCES workspaces(account_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE api_keys (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_prefix text NOT NULL,
  key_hash char(64) NOT NULL UNIQUE,
  masked_key text NOT NULL,
  environment text NOT NULL CHECK (environment IN ('live','test')),
  scopes text[] NOT NULL,
  status text NOT NULL CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL,
  last_used_at timestamptz,
  expires_at timestamptz
);

CREATE INDEX api_keys_account_created_idx
  ON api_keys(account_id, created_at DESC);

CREATE INDEX api_keys_account_status_idx
  ON api_keys(account_id, status);

CREATE TABLE api_usage (
  id text PRIMARY KEY,
  request_id text NOT NULL,
  api_key_id text REFERENCES api_keys(id) ON DELETE SET NULL,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ai_id text NOT NULL,
  endpoint text NOT NULL,
  occurred_at timestamptz NOT NULL,
  status integer NOT NULL,
  latency_ms integer NOT NULL CHECK (latency_ms >= 0),
  refused boolean NOT NULL,
  grounded boolean NOT NULL,
  error_code text
);

CREATE INDEX api_usage_account_occurred_idx
  ON api_usage(account_id, occurred_at DESC);

CREATE INDEX api_usage_key_occurred_idx
  ON api_usage(api_key_id, occurred_at DESC);

CREATE TABLE dataset_import_runs (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status text NOT NULL
    CHECK (status IN ('PREVIEWED','IMPORTED','FAILED')),
  created_at timestamptz NOT NULL,
  completed_at timestamptz,
  filename text NOT NULL,
  format text NOT NULL CHECK (format IN ('CSV','XLSX')),
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text
);

CREATE TABLE datasets (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  current_version_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, id)
);

CREATE INDEX datasets_account_updated_idx
  ON datasets(account_id, updated_at DESC);

CREATE TABLE dataset_versions (
  id text PRIMARY KEY,
  dataset_id text NOT NULL REFERENCES datasets(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  created_at timestamptz NOT NULL,
  source_filename text NOT NULL,
  source_mime_type text NOT NULL,
  source_size_bytes bigint NOT NULL CHECK (source_size_bytes >= 0),
  source_sha256 char(64) NOT NULL,
  source_format text NOT NULL CHECK (source_format IN ('CSV','XLSX')),
  import_run_id text NOT NULL REFERENCES dataset_import_runs(id),
  payload_backend text NOT NULL,
  payload_ref text NOT NULL,
  UNIQUE (dataset_id, version_number),
  UNIQUE (dataset_id, id)
);

ALTER TABLE datasets
  ADD CONSTRAINT datasets_current_version_fk
  FOREIGN KEY (id, current_version_id)
  REFERENCES dataset_versions(dataset_id, id)
  DEFERRABLE INITIALLY DEFERRED;
