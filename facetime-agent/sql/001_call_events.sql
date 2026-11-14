-- Run once against your Tiger Data service before enabling TIGER_DATABASE_URL.
CREATE TABLE IF NOT EXISTS call_events (
  time        timestamptz NOT NULL,
  call_id     text        NOT NULL,
  event_seq   bigint      NOT NULL,
  event       text        NOT NULL,
  agent_state text,
  media       text,
  details     jsonb
);

ALTER TABLE call_events ADD COLUMN IF NOT EXISTS event_seq bigint;
ALTER TABLE call_events ADD COLUMN IF NOT EXISTS details jsonb;
SELECT create_hypertable('call_events', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS call_events_call_id_time_idx ON call_events (call_id, time DESC);
CREATE INDEX IF NOT EXISTS call_events_call_id_seq_idx ON call_events (call_id, event_seq);

-- Example live activity query:
-- SELECT time, call_id, event_seq, event, agent_state, media
-- FROM call_events WHERE time > now() - interval '1 hour'
-- ORDER BY time DESC, call_id, event_seq LIMIT 200;
