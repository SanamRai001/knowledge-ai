CREATE TABLE integration_sync_worker_jobs (
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  connection_id text NOT NULL,
  worker_job_id text NOT NULL,
  requested_at timestamptz NOT NULL,
  requested_by text,
  sync_run_id text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, worker_job_id),
  CONSTRAINT integration_sync_worker_job_connection_fk
    FOREIGN KEY (account_id, connection_id)
    REFERENCES integration_connections(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT integration_sync_worker_job_worker_fk
    FOREIGN KEY (account_id, worker_job_id)
    REFERENCES worker_jobs(account_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT integration_sync_worker_job_run_fk
    FOREIGN KEY (account_id, sync_run_id)
    REFERENCES integration_sync_runs(account_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX integration_sync_worker_jobs_connection_idx
  ON integration_sync_worker_jobs(
    account_id,
    connection_id,
    created_at DESC
  );

CREATE INDEX integration_sync_worker_jobs_run_idx
  ON integration_sync_worker_jobs(account_id, sync_run_id)
  WHERE sync_run_id IS NOT NULL;
