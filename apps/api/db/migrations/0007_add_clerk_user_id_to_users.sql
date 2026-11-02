-- Link local accounts to Clerk users when AUTH_PROVIDER=clerk. Nullable and
-- additive: deployments on the built-in session auth never populate it, and
-- every existing row, role and membership is untouched.
ALTER TABLE users ADD COLUMN clerk_user_id VARCHAR(64) NULL;

CREATE UNIQUE INDEX users_clerk_user_id_unique ON users (clerk_user_id);
