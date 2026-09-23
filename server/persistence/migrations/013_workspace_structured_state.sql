CREATE TABLE workspace_specialized_ai (
  account_id text NOT NULL,
  workspace_id text NOT NULL,
  id text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  role_definition text NOT NULL,
  system_prompt_modifier text,
  response_style text NOT NULL
    CHECK (
      response_style IN (
        'concise',
        'detailed',
        'bullet-points',
        'executive-summary'
      )
    ),
  citation_mode text NOT NULL
    CHECK (
      citation_mode IN (
        'standard',
        'strict-snippets',
        'academic'
      )
    ),
  strict_refusal boolean NOT NULL,
  confidence_threshold double precision,
  memory_enabled boolean,
  memory_retrieval_enabled boolean,
  allowed_memory_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  max_retrieved_memories integer,
  memory_confidence_threshold double precision,
  allow_candidate_generation boolean,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, workspace_id),
  UNIQUE (account_id, id),
  CONSTRAINT workspace_specialized_ai_workspace_fk
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces(account_id, id)
    ON DELETE CASCADE
);

CREATE TABLE workspace_knowledge_versions (
  account_id text NOT NULL,
  workspace_id text NOT NULL,
  id text NOT NULL,
  version_number integer NOT NULL CHECK (version_number >= 1),
  version_tag text NOT NULL,
  label text NOT NULL,
  occurred_at timestamptz NOT NULL,
  document_count integer NOT NULL CHECK (document_count >= 0),
  total_pages integer NOT NULL CHECK (total_pages >= 0),
  legacy_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  document_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_current boolean NOT NULL,
  PRIMARY KEY (account_id, workspace_id, id),
  UNIQUE (account_id, workspace_id, version_number),
  UNIQUE (account_id, workspace_id, version_tag),
  CONSTRAINT workspace_knowledge_versions_workspace_fk
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces(account_id, id)
    ON DELETE CASCADE
);

CREATE UNIQUE INDEX workspace_knowledge_versions_one_current_idx
  ON workspace_knowledge_versions(account_id, workspace_id)
  WHERE is_current = true;

CREATE INDEX workspace_knowledge_versions_order_idx
  ON workspace_knowledge_versions(
    account_id,
    workspace_id,
    version_number DESC
  );

CREATE TABLE workspace_chat_messages (
  account_id text NOT NULL,
  workspace_id text NOT NULL,
  id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  content text NOT NULL,
  occurred_at timestamptz NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (account_id, workspace_id, id),
  CONSTRAINT workspace_chat_messages_workspace_fk
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX workspace_chat_messages_order_idx
  ON workspace_chat_messages(
    account_id,
    workspace_id,
    occurred_at ASC,
    id ASC
  );

CREATE TABLE workspace_evaluation_test_cases (
  account_id text NOT NULL,
  workspace_id text NOT NULL,
  id text NOT NULL,
  category text NOT NULL
    CHECK (
      category IN (
        'grounded',
        'cross-document',
        'negative-refusal',
        'custom'
      )
    ),
  question text NOT NULL,
  expected_behavior text NOT NULL,
  expected_keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  must_refuse boolean,
  PRIMARY KEY (account_id, workspace_id, id),
  CONSTRAINT workspace_evaluation_test_cases_workspace_fk
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX workspace_evaluation_test_cases_order_idx
  ON workspace_evaluation_test_cases(
    account_id,
    workspace_id,
    id ASC
  );

CREATE TABLE workspace_evaluation_runs (
  account_id text NOT NULL,
  workspace_id text NOT NULL,
  id text NOT NULL,
  version_tag text NOT NULL,
  occurred_at timestamptz NOT NULL,
  total_tests integer NOT NULL CHECK (total_tests >= 0),
  passed_count integer NOT NULL CHECK (passed_count >= 0),
  failed_count integer NOT NULL CHECK (failed_count >= 0),
  accuracy_score integer NOT NULL,
  grounded_score integer NOT NULL,
  cross_doc_score integer NOT NULL,
  refusal_score integer NOT NULL,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (account_id, workspace_id, id),
  CONSTRAINT workspace_evaluation_runs_workspace_fk
    FOREIGN KEY (account_id, workspace_id)
    REFERENCES workspaces(account_id, id)
    ON DELETE CASCADE
);

CREATE INDEX workspace_evaluation_runs_order_idx
  ON workspace_evaluation_runs(
    account_id,
    workspace_id,
    occurred_at DESC,
    id DESC
  );
