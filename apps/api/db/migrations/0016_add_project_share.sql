-- Public share links. A token is issued when sharing is first turned on and
-- kept if sharing is turned off so the same URL works again until rotated.

ALTER TABLE projects ADD COLUMN share_enabled {{BOOL}} NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN share_token CHAR(36) NULL;

CREATE UNIQUE INDEX projects_share_token_unique ON projects (share_token);

-- Which scopes / revisions appear on the public page (off until chosen).
ALTER TABLE checklist_sections ADD COLUMN public_visible {{BOOL}} NOT NULL DEFAULT 0;

-- Guest Client ticks have no user account; the name they typed is stored here.
ALTER TABLE tasks ADD COLUMN client_checked_guest_name VARCHAR(80) NULL;
