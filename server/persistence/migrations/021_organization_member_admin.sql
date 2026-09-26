CREATE TABLE account_membership_admin_audit (
  id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  actor_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  target_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL
    CHECK (action IN ('ROLE_CHANGED','STATUS_CHANGED')),
  previous_role text NOT NULL
    CHECK (previous_role IN ('OWNER','ADMIN','MEMBER')),
  next_role text NOT NULL
    CHECK (next_role IN ('OWNER','ADMIN','MEMBER')),
  previous_status text NOT NULL
    CHECK (previous_status IN ('ACTIVE','REVOKED')),
  next_status text NOT NULL
    CHECK (next_status IN ('ACTIVE','REVOKED')),
  occurred_at timestamptz NOT NULL
);

CREATE INDEX account_membership_admin_audit_account_time_idx
  ON account_membership_admin_audit(account_id, occurred_at DESC, id DESC);

CREATE INDEX account_membership_admin_audit_target_idx
  ON account_membership_admin_audit(account_id, target_user_id, occurred_at DESC);
