CREATE TABLE automation_execution_worker_jobs (
  account_id text NOT NULL
    REFERENCES accounts(id)
    ON DELETE CASCADE,
  proposal_id text NOT NULL,
  worker_job_id text NOT NULL,
  requested_at timestamptz NOT NULL,
  requested_by text NOT NULL,
  identity_source text NOT NULL
    CHECK (
      identity_source IN (
        'API_KEY',
        'HUMAN_SESSION',
        'DEFAULT_WEB'
      )
    ),
  principal_id text,
  requested_role text,
  authorization_revision_at timestamptz,
  automation_run_id text,
  action_execution_id text,
  outcome_code text,
  outcome_message text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, worker_job_id),
  CONSTRAINT automation_execution_worker_proposal_fk
    FOREIGN KEY (account_id, proposal_id)
    REFERENCES action_proposals(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT automation_execution_worker_job_fk
    FOREIGN KEY (account_id, worker_job_id)
    REFERENCES worker_jobs(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT automation_execution_worker_run_fk
    FOREIGN KEY (account_id, automation_run_id)
    REFERENCES automation_runs(account_id, id),
  CONSTRAINT automation_execution_worker_action_fk
    FOREIGN KEY (account_id, action_execution_id)
    REFERENCES action_executions(account_id, id)
);

CREATE INDEX automation_execution_worker_jobs_proposal_idx
  ON automation_execution_worker_jobs(
    account_id,
    proposal_id,
    created_at DESC,
    worker_job_id DESC
  );

CREATE INDEX automation_execution_worker_jobs_run_idx
  ON automation_execution_worker_jobs(
    account_id,
    automation_run_id
  )
  WHERE automation_run_id IS NOT NULL;
