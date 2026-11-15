import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { closeTigerData, queryTigerData } from './tiger-data.mjs';

const port = Number(process.env.DASHBOARD_PORT || 4173);
const host = '127.0.0.1';
const htmlPath = join(dirname(fileURLToPath(import.meta.url)), 'dashboard.html');

const dashboardHtml = await readFile(htmlPath, 'utf8');
const server = createServer(async (request, response) => {
  if (request.url === '/api/live') {
    try {
      const [summary, hourly, events] = await Promise.all([
        queryTigerData(`
          WITH latest AS (
            SELECT DISTINCT ON (call_id) call_id, event
            FROM call_events
            ORDER BY call_id, event_seq DESC NULLS LAST, time DESC
          )
          SELECT
            (SELECT count(DISTINCT call_id) FROM call_events
              WHERE event = 'call_started' AND time >= now() - interval '24 hours') AS calls_24h,
            (SELECT count(*) FROM call_events
              WHERE time >= now() - interval '24 hours') AS events_24h,
            (SELECT count(*) FROM latest WHERE event <> 'call_ended') AS active_calls
        `),
        queryTigerData(`
          SELECT date_trunc('hour', time) AS hour, count(*) AS count
          FROM call_events
          WHERE time >= now() - interval '12 hours'
          GROUP BY 1 ORDER BY 1
        `),
        queryTigerData(`
          SELECT time, call_id, event_seq, event, agent_state, media
          FROM call_events
          ORDER BY time DESC, call_id, event_seq DESC NULLS LAST
          LIMIT 100
        `),
      ]);
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({
        updatedAt: new Date().toISOString(),
        summary: summary.rows[0],
        hourly: hourly.rows,
        events: events.rows,
      }));
    } catch (error) {
      console.error('[dashboard] Tiger Data query failed:', error.code || error.name);
      const message = ['SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(error.code)
        ? 'Tiger Data TLS certificate validation failed. Check local network certificate trust; TLS verification stays enabled.'
        : error.code === '42P01'
          ? 'The call_events table is missing. Run sql/001_call_events.sql in Tiger Console.'
          : 'Tiger Data is not ready. Check the connection and run sql/001_call_events.sql.';
      response.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: message }));
    }
    return;
  }

  if (request.url !== '/') {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  response.end(dashboardHtml);
});

server.listen(port, host, () => console.log(`[dashboard] Live at http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(async () => {
    await closeTigerData();
    process.exit(0);
  }));
}
