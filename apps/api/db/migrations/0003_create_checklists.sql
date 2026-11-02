-- Checklist sections, tasks and comments.

CREATE TABLE checklist_sections (
  id          {{PK}},
  uuid        CHAR(36)      NOT NULL,
  project_id  {{FK}}        NOT NULL,
  title       VARCHAR(160)  NOT NULL,
  description TEXT          NULL,
  position    INT           NOT NULL DEFAULT 0,
  created_at  DATETIME      NOT NULL,
  updated_at  DATETIME      NOT NULL,
  deleted_at  DATETIME      NULL,
  CONSTRAINT checklist_sections_project_fk FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
){{ENGINE}};

CREATE UNIQUE INDEX checklist_sections_uuid_unique ON checklist_sections (uuid);
CREATE INDEX checklist_sections_project_pos_idx    ON checklist_sections (project_id, position);

-- One row = one line of the scope document:
--   [Checked by: Developer | Client]  Item description  [Remarks status]
CREATE TABLE tasks (
  id                    {{PK}},
  uuid                  CHAR(36)      NOT NULL,
  project_id            {{FK}}        NOT NULL,
  section_id            {{FK}}        NOT NULL,
  title                 VARCHAR(255)  NOT NULL,
  description           TEXT          NULL,
  -- Remarks: not_started | in_development | for_qa | for_revision | done_for_production
  --          | for_user_acceptance | done | for_beta_testing | completed | on_hold | not_applicable
  status                VARCHAR(30)   NOT NULL DEFAULT 'not_started',
  developer_checked_by  {{FK}}        NULL,
  developer_checked_at  DATETIME      NULL,
  client_checked_by     {{FK}}        NULL,
  client_checked_at     DATETIME      NULL,
  due_date              DATE          NULL,
  priority              VARCHAR(10)   NOT NULL DEFAULT 'medium',   -- low | medium | high
  assignee_id           {{FK}}        NULL,
  position              INT           NOT NULL DEFAULT 0,
  created_at            DATETIME      NOT NULL,
  updated_at            DATETIME      NOT NULL,
  deleted_at            DATETIME      NULL,
  CONSTRAINT tasks_project_fk      FOREIGN KEY (project_id)           REFERENCES projects (id)           ON DELETE CASCADE,
  CONSTRAINT tasks_section_fk      FOREIGN KEY (section_id)           REFERENCES checklist_sections (id) ON DELETE CASCADE,
  CONSTRAINT tasks_dev_checked_fk  FOREIGN KEY (developer_checked_by) REFERENCES users (id)              ON DELETE SET NULL,
  CONSTRAINT tasks_cli_checked_fk  FOREIGN KEY (client_checked_by)    REFERENCES users (id)              ON DELETE SET NULL,
  CONSTRAINT tasks_assignee_fk     FOREIGN KEY (assignee_id)          REFERENCES users (id)              ON DELETE SET NULL
){{ENGINE}};

CREATE UNIQUE INDEX tasks_uuid_unique   ON tasks (uuid);
CREATE INDEX tasks_project_idx          ON tasks (project_id);
CREATE INDEX tasks_section_pos_idx      ON tasks (section_id, position);
CREATE INDEX tasks_assignee_idx         ON tasks (assignee_id);
CREATE INDEX tasks_due_date_idx         ON tasks (due_date);
CREATE INDEX tasks_status_idx           ON tasks (project_id, status);

CREATE TABLE task_comments (
  id          {{PK}},
  uuid        CHAR(36)  NOT NULL,
  task_id     {{FK}}    NOT NULL,
  author_id   {{FK}}    NOT NULL,
  body        TEXT      NOT NULL,
  created_at  DATETIME  NOT NULL,
  updated_at  DATETIME  NOT NULL,
  deleted_at  DATETIME  NULL,
  CONSTRAINT task_comments_task_fk   FOREIGN KEY (task_id)   REFERENCES tasks (id) ON DELETE CASCADE,
  CONSTRAINT task_comments_author_fk FOREIGN KEY (author_id) REFERENCES users (id)
){{ENGINE}};

CREATE UNIQUE INDEX task_comments_uuid_unique ON task_comments (uuid);
CREATE INDEX task_comments_task_idx           ON task_comments (task_id, created_at);
