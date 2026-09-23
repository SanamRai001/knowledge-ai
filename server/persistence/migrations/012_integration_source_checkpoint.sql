ALTER TABLE integration_external_imports
  ADD COLUMN source_version_id text;

ALTER TABLE integration_external_imports
  ADD CONSTRAINT integration_external_import_source_version_fk
  FOREIGN KEY (account_id, source_version_id)
  REFERENCES source_versions(account_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX integration_external_import_source_version_idx
  ON integration_external_imports(account_id, source_version_id)
  WHERE source_version_id IS NOT NULL;
