-- Optional phases group scopes and revisions inside a project. A project can
-- have none; sections with no phase_id stay in the ungrouped list.
--   phase: title + position per project
--   checklist_sections.phase_id: nullable; SET NULL when the phase is removed

CREATE TABLE project_phases (
  id          {{PK}},
  uuid        CHAR(36)      NOT NULL,
  project_id  {{FK}}        NOT NULL,
  title       VARCHAR(160)  NOT NULL,
  position    INT           NOT NULL DEFAULT 0,
  created_at  DATETIME      NOT NULL,
  updated_at  DATETIME      NOT NULL,
  deleted_at  DATETIME      NULL,
  CONSTRAINT project_phases_project_fk FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
){{ENGINE}};

CREATE UNIQUE INDEX project_phases_uuid_unique ON project_phases (uuid);
CREATE INDEX project_phases_project_pos_idx    ON project_phases (project_id, position);

ALTER TABLE checklist_sections ADD COLUMN phase_id {{FK}} NULL;
CREATE INDEX checklist_sections_phase_idx ON checklist_sections (phase_id);
