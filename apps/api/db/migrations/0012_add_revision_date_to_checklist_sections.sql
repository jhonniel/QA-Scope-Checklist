-- Calendar date the user set for a revision ("Revision as of …"). Independent
-- of completed_at, which still tracks when every task resolved.

ALTER TABLE checklist_sections ADD COLUMN revision_date DATE NULL;

-- Existing finished revisions keep showing a date until someone picks one.
UPDATE checklist_sections
SET revision_date = DATE(completed_at)
WHERE kind = 'revision' AND completed_at IS NOT NULL AND revision_date IS NULL;
