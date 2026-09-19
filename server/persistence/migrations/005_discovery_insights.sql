CREATE TABLE discovery_analysis_runs (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_type text NOT NULL
    CHECK (source_type IN ('DATASET','DOCUMENT')),
  dataset_id text,
  dataset_version_id text,
  workspace_id text,
  knowledge_version_tag text,
  status text NOT NULL
    CHECK (status IN ('RUNNING','COMPLETED','FAILED')),
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  reference_time timestamptz NOT NULL,
  detector_ids text[] NOT NULL,
  detector_registrations jsonb,
  error text,
  UNIQUE (account_id, id),
  CONSTRAINT discovery_analysis_run_source_shape CHECK (
    (
      source_type = 'DATASET' AND
      dataset_id IS NOT NULL AND
      dataset_version_id IS NOT NULL AND
      workspace_id IS NULL AND
      knowledge_version_tag IS NULL
    ) OR (
      source_type = 'DOCUMENT' AND
      dataset_id IS NULL AND
      dataset_version_id IS NULL AND
      workspace_id IS NOT NULL AND
      knowledge_version_tag IS NOT NULL
    )
  ),
  CONSTRAINT discovery_analysis_run_dataset_fk
    FOREIGN KEY (account_id, dataset_id)
    REFERENCES datasets(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT discovery_analysis_run_dataset_version_fk
    FOREIGN KEY (account_id, dataset_id, dataset_version_id)
    REFERENCES dataset_versions(account_id, dataset_id, id)
    ON DELETE CASCADE,
  CONSTRAINT discovery_analysis_run_workspace_fk
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX discovery_analysis_runs_account_started_idx
  ON discovery_analysis_runs(account_id, started_at DESC);

CREATE INDEX discovery_analysis_runs_dataset_started_idx
  ON discovery_analysis_runs(account_id, dataset_id, started_at DESC)
  WHERE dataset_id IS NOT NULL;

CREATE INDEX discovery_analysis_runs_workspace_started_idx
  ON discovery_analysis_runs(account_id, workspace_id, started_at DESC)
  WHERE workspace_id IS NOT NULL;

CREATE TABLE discovery_insights (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  dataset_id text,
  dataset_version_id text,
  workspace_id text,
  document_id text,
  latest_analysis_run_id text NOT NULL,
  type text NOT NULL
    CHECK (type IN ('RISK','OPPORTUNITY','CHANGE','DEADLINE','ANOMALY','DATA_QUALITY')),
  severity text NOT NULL
    CHECK (severity IN ('LOW','MEDIUM','HIGH')),
  status text NOT NULL
    CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  title text NOT NULL,
  summary text NOT NULL,
  confidence numeric NOT NULL
    CHECK (confidence >= 0 AND confidence <= 1),
  detector_id text NOT NULL,
  detector_version text NOT NULL,
  evidence jsonb NOT NULL,
  priority_score numeric NOT NULL,
  priority_reasons text[] NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  occurrence_count integer NOT NULL CHECK (occurrence_count > 0),
  status_updated_at timestamptz,
  created_at timestamptz NOT NULL,
  UNIQUE (account_id, id),
  UNIQUE (account_id, fingerprint),
  CONSTRAINT discovery_insight_source_shape CHECK (
    (
      dataset_id IS NOT NULL AND
      dataset_version_id IS NOT NULL AND
      workspace_id IS NULL
    ) OR (
      dataset_id IS NULL AND
      dataset_version_id IS NULL AND
      workspace_id IS NOT NULL
    )
  ),
  CONSTRAINT discovery_insight_dataset_fk
    FOREIGN KEY (account_id, dataset_id)
    REFERENCES datasets(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT discovery_insight_dataset_version_fk
    FOREIGN KEY (account_id, dataset_id, dataset_version_id)
    REFERENCES dataset_versions(account_id, dataset_id, id)
    ON DELETE CASCADE,
  CONSTRAINT discovery_insight_workspace_fk
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT discovery_insight_latest_run_fk
    FOREIGN KEY (account_id, latest_analysis_run_id)
    REFERENCES discovery_analysis_runs(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX discovery_insights_account_priority_idx
  ON discovery_insights(account_id, priority_score DESC, last_seen_at DESC);

CREATE INDEX discovery_insights_account_status_idx
  ON discovery_insights(account_id, status, priority_score DESC, last_seen_at DESC);

CREATE TABLE discovery_analysis_run_insights (
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  analysis_run_id text NOT NULL,
  insight_id text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  PRIMARY KEY (account_id, analysis_run_id, insight_id),
  UNIQUE (account_id, analysis_run_id, position),
  CONSTRAINT discovery_run_insight_run_fk
    FOREIGN KEY (account_id, analysis_run_id)
    REFERENCES discovery_analysis_runs(account_id, id)
    ON DELETE CASCADE,
  CONSTRAINT discovery_run_insight_insight_fk
    FOREIGN KEY (account_id, insight_id)
    REFERENCES discovery_insights(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX discovery_analysis_run_insights_insight_idx
  ON discovery_analysis_run_insights(account_id, insight_id);
