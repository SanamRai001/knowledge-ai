CREATE TABLE account_secrets (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  purpose text NOT NULL
    CHECK (purpose IN ('INTEGRATION_OAUTH','WEBHOOK_SIGNING','OTHER_ACCOUNT_CREDENTIAL')),
  provider text,
  status text NOT NULL
    CHECK (status IN ('ACTIVE','REVOKED','DELETED')),
  current_version integer NOT NULL CHECK (current_version > 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  revoked_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (account_id, id)
);

CREATE INDEX account_secrets_scope_idx
  ON account_secrets(account_id, purpose, provider, status, updated_at DESC);

CREATE TABLE account_secret_versions (
  account_id text NOT NULL,
  secret_id text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  kms_key_id text NOT NULL,
  kms_algorithm text NOT NULL,
  ciphertext text NOT NULL,
  status text NOT NULL
    CHECK (status IN ('ACTIVE','RETIRED','REVOKED')),
  created_at timestamptz NOT NULL,
  retired_at timestamptz,
  PRIMARY KEY (account_id, secret_id, version),
  CONSTRAINT account_secret_versions_secret_fk
    FOREIGN KEY (account_id, secret_id)
    REFERENCES account_secrets(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX account_secret_versions_key_idx
  ON account_secret_versions(kms_key_id, status);

CREATE TABLE account_secret_audit_events (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  secret_id text NOT NULL,
  purpose text NOT NULL,
  provider text,
  operation text NOT NULL
    CHECK (operation IN ('CREATE','READ','ROTATE','REVOKE','DELETE','MIGRATE')),
  secret_version integer,
  occurred_at timestamptz NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('SUCCEEDED','FAILED')),
  error_code text
);

CREATE INDEX account_secret_audit_scope_idx
  ON account_secret_audit_events(account_id, secret_id, occurred_at DESC);
