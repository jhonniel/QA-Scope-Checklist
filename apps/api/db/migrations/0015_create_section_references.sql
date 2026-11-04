-- Notes and links attached to a scope or revision after it exists.

CREATE TABLE section_references (
  id          {{PK}},
  uuid        CHAR(36)      NOT NULL,
  section_id  {{FK}}        NOT NULL,
  author_id   {{FK}}        NOT NULL,
  kind        VARCHAR(10)   NOT NULL,
  body        TEXT          NOT NULL,
  title       VARCHAR(160)  NULL,
  created_at  DATETIME      NOT NULL,
  updated_at  DATETIME      NOT NULL,
  deleted_at  DATETIME      NULL,
  CONSTRAINT section_references_section_fk FOREIGN KEY (section_id) REFERENCES checklist_sections (id) ON DELETE CASCADE,
  CONSTRAINT section_references_author_fk  FOREIGN KEY (author_id)  REFERENCES users (id)
){{ENGINE}};

CREATE UNIQUE INDEX section_references_uuid_unique ON section_references (uuid);
CREATE INDEX section_references_section_idx        ON section_references (section_id, created_at);
