-- Append-only activity log and export templates.

CREATE TABLE activity_logs (
  id          {{PK}},
  uuid        CHAR(36)      NOT NULL,
  project_id  {{FK}}        NOT NULL,
  actor_id    {{FK}}        NOT NULL,
  action      VARCHAR(40)   NOT NULL,   -- e.g. task.checked, task.status_changed (see contracts ActivityAction)
  subject     VARCHAR(255)  NOT NULL,
  meta        {{JSON}}      NULL,       -- small structured payload only when genuinely needed
  created_at  DATETIME      NOT NULL,
  CONSTRAINT activity_logs_project_fk FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
  CONSTRAINT activity_logs_actor_fk   FOREIGN KEY (actor_id)   REFERENCES users (id)
){{ENGINE}};

CREATE UNIQUE INDEX activity_logs_uuid_unique     ON activity_logs (uuid);
CREATE INDEX activity_logs_project_created_idx    ON activity_logs (project_id, created_at);
CREATE INDEX activity_logs_created_idx            ON activity_logs (created_at);

CREATE TABLE export_templates (
  id          {{PK}},
  uuid        CHAR(36)      NOT NULL,
  name        VARCHAR(120)  NOT NULL,
  description TEXT          NULL,
  is_default  {{BOOL}}      NOT NULL DEFAULT 0,
  definition  {{JSON}}      NOT NULL,   -- layout definition consumed by the export service (Phase 5)
  created_at  DATETIME      NOT NULL,
  updated_at  DATETIME      NOT NULL
){{ENGINE}};

CREATE UNIQUE INDEX export_templates_uuid_unique ON export_templates (uuid);
