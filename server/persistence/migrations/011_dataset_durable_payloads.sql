ALTER TABLE dataset_versions
  ADD COLUMN source_version_id text,
  ADD COLUMN payload_storage_backend text,
  ADD COLUMN payload_size_bytes bigint,
  ADD COLUMN payload_sha256 char(64);

ALTER TABLE dataset_versions
  ADD CONSTRAINT dataset_versions_owned_source_version_fk
  FOREIGN KEY (account_id, source_version_id)
  REFERENCES source_versions(account_id, id)
  DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE dataset_versions
  ADD CONSTRAINT dataset_versions_payload_size_check
  CHECK (
    payload_size_bytes IS NULL OR
    payload_size_bytes >= 0
  );

ALTER TABLE dataset_versions
  ADD CONSTRAINT dataset_versions_payload_sha256_check
  CHECK (
    payload_sha256 IS NULL OR
    payload_sha256 ~ '^[0-9a-f]{64}$'
  );

CREATE INDEX dataset_versions_source_version_idx
  ON dataset_versions(account_id, source_version_id)
  WHERE source_version_id IS NOT NULL;
