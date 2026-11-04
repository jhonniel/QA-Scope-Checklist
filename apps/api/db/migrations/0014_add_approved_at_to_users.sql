-- Self-registered accounts wait for an administrator. Existing accounts stay
-- usable: they are treated as already approved on the day they were created.

ALTER TABLE users ADD COLUMN approved_at DATETIME NULL;

UPDATE users SET approved_at = created_at WHERE approved_at IS NULL;
