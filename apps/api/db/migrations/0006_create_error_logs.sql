-- Error log for administrators: unhandled API failures (5xx) and errors the web
-- app reports from its error boundary. Append-only — never updated or deleted.
CREATE TABLE error_logs (
  id          {{PK}},
  uuid        CHAR(36)      NOT NULL,
  source      VARCHAR(10)   NOT NULL,   -- api | web
  status      SMALLINT      NULL,       -- HTTP status answered (api only)
  code        VARCHAR(80)   NULL,       -- envelope code (api) or error class name (web)
  message     TEXT          NOT NULL,
  stack       TEXT          NULL,
  method      VARCHAR(10)   NULL,
  path        VARCHAR(2048) NULL,
  actor_id    {{FK}}        NULL,       -- signed-in user at the time, if any
  user_agent  VARCHAR(512)  NULL,
  context     {{JSON}}      NULL,
  created_at  DATETIME      NOT NULL,
  CONSTRAINT error_logs_actor_fk FOREIGN KEY (actor_id) REFERENCES users (id)
){{ENGINE}};

CREATE UNIQUE INDEX error_logs_uuid_unique ON error_logs (uuid);
CREATE INDEX error_logs_created_idx        ON error_logs (created_at);
CREATE INDEX error_logs_source_created_idx ON error_logs (source, created_at);
