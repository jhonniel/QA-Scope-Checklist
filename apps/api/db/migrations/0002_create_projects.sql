-- Projects, membership and invitations.

CREATE TABLE projects (
  id          {{PK}},
  uuid        CHAR(36)      NOT NULL,
  owner_id    {{FK}}        NOT NULL,
  name        VARCHAR(160)  NOT NULL,
  description TEXT          NULL,
  status      VARCHAR(20)   NOT NULL DEFAULT 'active',   -- active | completed | archived
  start_date  DATE          NULL,
  deadline    DATE          NULL,
  created_at  DATETIME      NOT NULL,
  updated_at  DATETIME      NOT NULL,
  deleted_at  DATETIME      NULL,
  CONSTRAINT projects_owner_fk FOREIGN KEY (owner_id) REFERENCES users (id)
){{ENGINE}};

CREATE UNIQUE INDEX projects_uuid_unique ON projects (uuid);
CREATE INDEX projects_owner_idx          ON projects (owner_id);
CREATE INDEX projects_status_idx         ON projects (status);

-- Pivot: who can access a project and with which role. The owner also has a row (role = owner).
CREATE TABLE project_members (
  id          {{PK}},
  uuid        CHAR(36)    NOT NULL,
  project_id  {{FK}}      NOT NULL,
  user_id     {{FK}}      NOT NULL,
  role        VARCHAR(20) NOT NULL DEFAULT 'viewer',   -- owner | editor | viewer
  joined_at   DATETIME    NOT NULL,
  CONSTRAINT project_members_project_fk FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT project_members_user_fk    FOREIGN KEY (user_id)    REFERENCES users (id)    ON DELETE CASCADE
){{ENGINE}};

CREATE UNIQUE INDEX project_members_uuid_unique   ON project_members (uuid);
CREATE UNIQUE INDEX project_members_member_unique ON project_members (project_id, user_id);
CREATE INDEX project_members_user_idx             ON project_members (user_id);

CREATE TABLE project_invitations (
  id            {{PK}},
  uuid          CHAR(36)      NOT NULL,
  project_id    {{FK}}        NOT NULL,
  email         VARCHAR(191)  NOT NULL,
  role          VARCHAR(20)   NOT NULL DEFAULT 'viewer',   -- editor | viewer
  status        VARCHAR(20)   NOT NULL DEFAULT 'pending',  -- pending | accepted | declined | revoked
  invited_by    {{FK}}        NOT NULL,
  token_hash    CHAR(64)      NULL,
  created_at    DATETIME      NOT NULL,
  responded_at  DATETIME      NULL,
  CONSTRAINT project_invitations_project_fk FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT project_invitations_inviter_fk FOREIGN KEY (invited_by) REFERENCES users (id)
){{ENGINE}};

CREATE UNIQUE INDEX project_invitations_uuid_unique ON project_invitations (uuid);
CREATE INDEX project_invitations_project_idx        ON project_invitations (project_id);
CREATE INDEX project_invitations_email_status_idx   ON project_invitations (email, status);
