ALTER TABLE account_secrets
  DROP CONSTRAINT IF EXISTS account_secrets_purpose_check;

ALTER TABLE account_secrets
  ADD CONSTRAINT account_secrets_purpose_check
  CHECK (
    purpose IN (
      'INTEGRATION_OAUTH',
      'INTEGRATION_OAUTH_ATTEMPT',
      'WEBHOOK_SIGNING',
      'OTHER_ACCOUNT_CREDENTIAL'
    )
  );

CREATE TABLE security_rate_limit_events (
  id bigserial PRIMARY KEY,
  scope text NOT NULL
    CHECK (scope IN ('API_KEY','HUMAN_LOGIN')),
  subject_hash char(64) NOT NULL
    CHECK (subject_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL
);

CREATE INDEX security_rate_limit_subject_idx
  ON security_rate_limit_events(
    scope,
    subject_hash,
    occurred_at ASC
  );

CREATE INDEX security_rate_limit_cleanup_idx
  ON security_rate_limit_events(
    occurred_at ASC
  );

CREATE TABLE integration_oauth_attempts (
  provider text NOT NULL
    CHECK (
      provider IN (
        'GOOGLE_DRIVE',
        'MICROSOFT_ONEDRIVE'
      )
    ),
  state_hash char(64) PRIMARY KEY
    CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  account_id text NOT NULL
    REFERENCES accounts(id)
    ON DELETE CASCADE,
  display_name text NOT NULL,
  redirect_uri text NOT NULL,
  tenant text,
  connection_id text,
  secret_ref text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT integration_oauth_attempt_secret_fk
    FOREIGN KEY (account_id, secret_ref)
    REFERENCES account_secrets(account_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX integration_oauth_attempt_expiry_idx
  ON integration_oauth_attempts(
    expires_at ASC
  );

CREATE INDEX integration_oauth_attempt_account_idx
  ON integration_oauth_attempts(
    account_id,
    provider,
    created_at DESC
  );
