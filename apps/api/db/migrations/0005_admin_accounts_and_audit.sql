-- Administration (Phase 6): account disabling and an audit trail for admin actions.

-- Disabled accounts keep every record but can no longer sign in; existing sessions are revoked.
ALTER TABLE users ADD COLUMN disabled_at DATETIME NULL;

-- Append-only log of administrative actions that are not scoped to one project
-- (role changes, account disabling, forced sign-outs, restores). Never deleted.
CREATE TABLE admin_audit_logs (
  id           {{PK}},
  uuid         CHAR(36)      NOT NULL,
  actor_id     {{FK}}        NOT NULL,
  action       VARCHAR(40)   NOT NULL,   -- see contracts AdminAuditAction
  target_type  VARCHAR(20)   NOT NULL,   -- user | project
  target_uuid  CHAR(36)      NOT NULL,   -- public identifier of the affected record
  subject      VARCHAR(255)  NOT NULL,
  meta         {{JSON}}      NULL,
  created_at   DATETIME      NOT NULL,
  CONSTRAINT admin_audit_logs_actor_fk FOREIGN KEY (actor_id) REFERENCES users (id)
){{ENGINE}};

CREATE UNIQUE INDEX admin_audit_logs_uuid_unique  ON admin_audit_logs (uuid);
CREATE INDEX admin_audit_logs_created_idx         ON admin_audit_logs (created_at);
CREATE INDEX admin_audit_logs_target_idx          ON admin_audit_logs (target_type, target_uuid);
