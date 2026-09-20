CREATE TABLE user_password_credentials (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  algorithm text NOT NULL CHECK (algorithm = 'scrypt-v1'),
  salt_base64 text NOT NULL,
  hash_base64 text NOT NULL,
  scrypt_n integer NOT NULL CHECK (scrypt_n >= 32768),
  scrypt_r integer NOT NULL CHECK (scrypt_r >= 8),
  scrypt_p integer NOT NULL CHECK (scrypt_p >= 1),
  key_length integer NOT NULL CHECK (key_length >= 32),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE auth_bootstrap_state (
  id text PRIMARY KEY CHECK (id = 'initial-owner'),
  consumed_at timestamptz,
  consumed_by_user_id text
);

INSERT INTO auth_bootstrap_state (id)
VALUES ('initial-owner')
ON CONFLICT (id) DO NOTHING;
