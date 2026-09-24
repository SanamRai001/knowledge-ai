CREATE TABLE action_execution_discovery_jobs (
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  execution_id text NOT NULL,
  worker_job_id text NOT NULL,
  dataset_id text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, execution_id, worker_job_id),
  UNIQUE (account_id, execution_id, dataset_id),
  CONSTRAINT action_execution_discovery_job_execution_fk
    FOREIGN KEY (account_id, execution_id)
    REFERENCES action_executions(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT action_execution_discovery_job_worker_fk
    FOREIGN KEY (account_id, worker_job_id)
    REFERENCES worker_jobs(account_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT action_execution_discovery_job_dataset_fk
    FOREIGN KEY (account_id, dataset_id)
    REFERENCES datasets(account_id, id)
    ON DELETE RESTRICT
);

CREATE INDEX action_execution_discovery_jobs_worker_idx
  ON action_execution_discovery_jobs(account_id, worker_job_id);

CREATE INDEX action_execution_discovery_jobs_dataset_idx
  ON action_execution_discovery_jobs(account_id, dataset_id);
