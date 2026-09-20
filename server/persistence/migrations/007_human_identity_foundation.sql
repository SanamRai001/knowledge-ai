CREATE TABLE users (
  id text PRIMARY KEY,
  email text NOT NULL,
  normalized_email text NOT NULL UNIQUE,
  display_name text,
  status text NOT NULL CHECK (status IN ('ACTIVE','DISABLED')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX users_status_created_idx
  ON users(status, created_at DESC);

CREATE TABLE account_memberships (
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('OWNER','ADMIN','MEMBER')),
  status text NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, user_id),
  UNIQUE (user_id, account_id)
);

CREATE INDEX account_memberships_user_status_idx
  ON account_memberships(user_id, status, account_id);

CREATE INDEX account_memberships_account_role_idx
  ON account_memberships(account_id, status, role);

CREATE TABLE browser_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL UNIQUE,
  selected_account_id text,
  selected_workspace_id text,
  status text NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (
    selected_workspace_id IS NULL OR
    selected_account_id IS NOT NULL
  ),
  CONSTRAINT browser_sessions_selected_membership_fk
    FOREIGN KEY (selected_account_id, user_id)
    REFERENCES account_memberships(account_id, user_id),
  CONSTRAINT browser_sessions_selected_workspace_fk
    FOREIGN KEY (selected_account_id, selected_workspace_id)
    REFERENCES workspaces(account_id, id)
);

CREATE INDEX browser_sessions_user_status_idx
  ON browser_sessions(user_id, status, expires_at DESC);

CREATE INDEX browser_sessions_account_status_idx
  ON browser_sessions(selected_account_id, status, expires_at DESC)
  WHERE selected_account_id IS NOT NULL;
