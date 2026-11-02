-- Users and authentication.
-- Internal integer PKs; `uuid` is the only identifier ever exposed publicly.

CREATE TABLE users (
  id            {{PK}},
  uuid          CHAR(36)      NOT NULL,
  name          VARCHAR(120)  NOT NULL,
  email         VARCHAR(191)  NOT NULL,
  password_hash VARCHAR(255)  NOT NULL,
  role          VARCHAR(20)   NOT NULL DEFAULT 'user',   -- admin | user
  avatar_url    VARCHAR(500)  NULL,
  created_at    DATETIME      NOT NULL,
  updated_at    DATETIME      NOT NULL,
  deleted_at    DATETIME      NULL
){{ENGINE}};

CREATE UNIQUE INDEX users_uuid_unique  ON users (uuid);
CREATE UNIQUE INDEX users_email_unique ON users (email);

-- Server-side sessions. Only the SHA-256 hash of the cookie token is stored.
CREATE TABLE sessions (
  id            {{PK}},
  token_hash    CHAR(64)      NOT NULL,
  user_id       {{FK}}        NOT NULL,
  ip_address    VARCHAR(45)   NULL,
  user_agent    VARCHAR(255)  NULL,
  created_at    DATETIME      NOT NULL,
  last_seen_at  DATETIME      NOT NULL,
  expires_at    DATETIME      NOT NULL,
  CONSTRAINT sessions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
){{ENGINE}};

CREATE UNIQUE INDEX sessions_token_unique ON sessions (token_hash);
CREATE INDEX sessions_user_idx            ON sessions (user_id);
CREATE INDEX sessions_expires_idx         ON sessions (expires_at);

-- Password reset tokens (hashed). Single use; expire quickly.
CREATE TABLE password_resets (
  id          {{PK}},
  user_id     {{FK}}      NOT NULL,
  token_hash  CHAR(64)    NOT NULL,
  created_at  DATETIME    NOT NULL,
  expires_at  DATETIME    NOT NULL,
  used_at     DATETIME    NULL,
  CONSTRAINT password_resets_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
){{ENGINE}};

CREATE UNIQUE INDEX password_resets_token_unique ON password_resets (token_hash);
CREATE INDEX password_resets_user_idx            ON password_resets (user_id);
