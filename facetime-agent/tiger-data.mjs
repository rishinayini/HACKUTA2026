// Optional Tiger Data (PostgreSQL) call telemetry. Call content is never recorded.
import pg from 'pg';

const { Pool } = pg;
let pool;
let pendingWrites = Promise.resolve();
const callSequences = new Map();

function getPool() {
  const connectionString = process.env.TIGER_DATABASE_URL;
  if (!connectionString) return undefined;
  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 3,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10_000,
      // Tiger Cloud requires TLS. `sslmode=require` in the URL enables it with pg.
    });
    pool.on('error', error => console.warn('[tiger-data] database connection error:', error.message));
  }
  return pool;
}

/** Best-effort event insert; telemetry failures must not interrupt a live call. */
export async function recordCallEvent({ callId, event, agentState, media, details }) {
  const db = getPool();
  if (!db) return;
  const eventSeq = (callSequences.get(callId) || 0) + 1;
  callSequences.set(callId, eventSeq);
  pendingWrites = pendingWrites.then(async () => {
    try {
      await db.query(
        `INSERT INTO call_events (time, call_id, event_seq, event, agent_state, media, details)
         VALUES (now(), $1, $2, $3, $4, $5, $6)`,
        [callId, eventSeq, event, agentState ?? null, media ?? null, details ? JSON.stringify(details) : null],
      );
    } catch (error) {
      console.warn('[tiger-data] could not record call event:', error.message);
    } finally {
      if (event === 'call_ended') callSequences.delete(callId);
    }
  });
  return pendingWrites;
}

export async function closeTigerData() {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end().catch(error => console.warn('[tiger-data] could not close connection pool:', error.message));
}
