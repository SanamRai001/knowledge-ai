CREATE TABLE worker_jobs (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  job_type text NOT NULL
    CHECK (job_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_ref text,
  idempotency_key text,
  concurrency_key text,
  priority integer NOT NULL DEFAULT 0
    CHECK (priority BETWEEN -1000 AND 1000),
  status text NOT NULL
    CHECK (
      status IN (
        'PENDING',
        'RUNNING',
        'SUCCEEDED',
        'FAILED',
        'DEAD_LETTER'
      )
    ),
  attempt_count integer NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3
    CHECK (max_attempts BETWEEN 1 AND 100),
  next_attempt_at timestamptz NOT NULL,
  lease_owner text,
  lease_token text,
  lease_expires_at timestamptz,
  last_heartbeat_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (account_id, id),
  CHECK (
    (
      status = 'RUNNING' AND
      lease_owner IS NOT NULL AND
      lease_token IS NOT NULL AND
      lease_expires_at IS NOT NULL
    ) OR (
      status <> 'RUNNING' AND
      lease_owner IS NULL AND
      lease_token IS NULL AND
      lease_expires_at IS NULL
    )
  ),
  CHECK (
    (
      status IN ('SUCCEEDED','FAILED','DEAD_LETTER') AND
      completed_at IS NOT NULL
    ) OR (
      status NOT IN ('SUCCEEDED','FAILED','DEAD_LETTER') AND
      completed_at IS NULL
    )
  ),
  CHECK (
    status <> 'PENDING' OR
    attempt_count < max_attempts
  )
);

CREATE UNIQUE INDEX worker_jobs_idempotency_idx
  ON worker_jobs(
    account_id,
    job_type,
    idempotency_key
  )
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX worker_jobs_running_concurrency_idx
  ON worker_jobs(
    account_id,
    job_type,
    concurrency_key
  )
  WHERE
    status = 'RUNNING' AND
    concurrency_key IS NOT NULL;

CREATE INDEX worker_jobs_ready_idx
  ON worker_jobs(
    priority DESC,
    next_attempt_at,
    created_at,
    id
  )
  WHERE status = 'PENDING';

CREATE INDEX worker_jobs_lease_expiry_idx
  ON worker_jobs(lease_expires_at)
  WHERE status = 'RUNNING';

CREATE INDEX worker_jobs_account_status_idx
  ON worker_jobs(
    account_id,
    status,
    updated_at DESC
  );
