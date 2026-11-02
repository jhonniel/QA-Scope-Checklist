-- The moment a section reached 100% (every task resolved). Cleared again when a
-- task is reopened or added, so it always describes the current state; the
-- activity log keeps the history. Printed beside revision sections as
-- "Revision as of <date>".
ALTER TABLE checklist_sections ADD COLUMN completed_at DATETIME NULL;

-- Backfill sections that are already complete, dated by their last task change —
-- the closest record we have of when they were finished.
UPDATE checklist_sections
SET completed_at = (SELECT MAX(t.updated_at) FROM tasks t WHERE t.section_id = checklist_sections.id AND t.deleted_at IS NULL)
WHERE deleted_at IS NULL
  AND EXISTS (SELECT 1 FROM tasks t WHERE t.section_id = checklist_sections.id AND t.deleted_at IS NULL)
  AND NOT EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.section_id = checklist_sections.id AND t.deleted_at IS NULL
      AND t.status NOT IN ('done_for_production', 'done', 'completed', 'not_applicable')
  );
