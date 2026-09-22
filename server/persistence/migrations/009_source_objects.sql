CREATE TABLE source_objects (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  workspace_id text,
  kind text NOT NULL
    CHECK (kind IN ('DOCUMENT','DATASET_SOURCE')),
  origin text NOT NULL
    CHECK (
      origin IN (
        'UPLOAD',
        'GOOGLE_DRIVE',
        'MICROSOFT_ONEDRIVE',
        'GENERATED'
      )
    ),
  external_connection_id text,
  external_id text,
  status text NOT NULL
    CHECK (status IN ('ACTIVE','TOMBSTONED')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, id),
  CONSTRAINT source_objects_owned_workspace_fk
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces(account_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX source_objects_account_updated_idx
  ON source_objects(account_id, updated_at DESC, id);

CREATE INDEX source_objects_external_lookup_idx
  ON source_objects(
    account_id,
    external_connection_id,
    external_id
  )
  WHERE external_id IS NOT NULL;

CREATE TABLE source_versions (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_object_id text NOT NULL,
  external_version text,
  original_filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 char(64) NOT NULL
    CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_backend text NOT NULL,
  storage_key text NOT NULL,
  storage_etag text,
  retention_state text NOT NULL
    CHECK (
      retention_state IN (
        'ACTIVE',
        'TOMBSTONED',
        'PURGE_PENDING'
      )
    ),
  created_at timestamptz NOT NULL,
  retention_updated_at timestamptz NOT NULL,
  UNIQUE (account_id, id),
  UNIQUE (account_id, source_object_id, id),
  UNIQUE (storage_backend, storage_key),
  CONSTRAINT source_versions_owned_object_fk
    FOREIGN KEY (account_id, source_object_id)
    REFERENCES source_objects(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX source_versions_object_created_idx
  ON source_versions(
    account_id,
    source_object_id,
    created_at DESC,
    id
  );

CREATE INDEX source_versions_account_sha_idx
  ON source_versions(account_id, sha256);

CREATE OR REPLACE FUNCTION enforce_source_version_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF
    NEW.id IS DISTINCT FROM OLD.id OR
    NEW.account_id IS DISTINCT FROM OLD.account_id OR
    NEW.source_object_id IS DISTINCT FROM OLD.source_object_id OR
    NEW.external_version IS DISTINCT FROM OLD.external_version OR
    NEW.original_filename IS DISTINCT FROM OLD.original_filename OR
    NEW.content_type IS DISTINCT FROM OLD.content_type OR
    NEW.size_bytes IS DISTINCT FROM OLD.size_bytes OR
    NEW.sha256 IS DISTINCT FROM OLD.sha256 OR
    NEW.storage_backend IS DISTINCT FROM OLD.storage_backend OR
    NEW.storage_key IS DISTINCT FROM OLD.storage_key OR
    NEW.storage_etag IS DISTINCT FROM OLD.storage_etag OR
    NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'source_versions immutable byte identity cannot be modified';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER source_versions_immutable_byte_identity
BEFORE UPDATE ON source_versions
FOR EACH ROW
EXECUTE FUNCTION enforce_source_version_immutability();
