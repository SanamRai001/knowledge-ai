CREATE TABLE document_derived_payloads (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  document_id text NOT NULL,
  source_version_id text NOT NULL,
  derivation_version text NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  source_size_bytes bigint NOT NULL CHECK (source_size_bytes >= 0),
  processing_status text NOT NULL
    CHECK (processing_status IN ('pending','processing','processed','failed')),
  error_message text,
  page_count integer NOT NULL CHECK (page_count >= 0),
  payload_backend text NOT NULL,
  payload_key text NOT NULL,
  payload_size_bytes bigint NOT NULL CHECK (payload_size_bytes >= 0),
  payload_sha256 char(64) NOT NULL
    CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, id),
  UNIQUE (
    account_id,
    workspace_id,
    document_id,
    source_version_id,
    derivation_version
  ),
  UNIQUE (payload_backend, payload_key),
  CONSTRAINT document_derived_payloads_owned_workspace_fk
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT document_derived_payloads_owned_source_version_fk
    FOREIGN KEY (account_id, source_version_id)
    REFERENCES source_versions(account_id, id)
);

CREATE INDEX document_derived_payloads_workspace_current_idx
  ON document_derived_payloads(
    account_id,
    workspace_id,
    is_current,
    updated_at DESC,
    document_id
  );

CREATE INDEX document_derived_payloads_source_idx
  ON document_derived_payloads(
    account_id,
    source_version_id,
    derivation_version
  );
