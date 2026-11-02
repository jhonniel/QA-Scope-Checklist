-- Sections are either part of the agreed scope or a revision raised later.
-- Additive: every existing section stays a 'scope' section; revisions are
-- printed in their own block of the exported document with their own chart.
--   kind: scope | revision
ALTER TABLE checklist_sections ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'scope';
