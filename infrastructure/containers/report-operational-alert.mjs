import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function reportOperationalAlert(source, message) {
  if (!['deploy-drift', 'deploy-preflight'].includes(source))
    throw new Error(`Unsupported operational alert source: ${source}`);

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) throw new Error('SENTRY_DSN is required to report an operational alert.');

  let parsed;
  try {
    parsed = new URL(dsn);
  } catch {
    throw new Error('SENTRY_DSN is invalid.');
  }

  const projectId = parsed.pathname.split('/').filter(Boolean).at(-1);
  if (!parsed.username || !projectId)
    throw new Error('SENTRY_DSN must include a public key and project ID.');

  const timestamp = new Date().toISOString();
  const event = {
    event_id: randomUUID().replaceAll('-', ''),
    timestamp,
    platform: 'node',
    level: 'error',
    logger: 'must-booking.operations',
    message,
    tags: {
      component: 'deploy',
      operation: source,
      environment: process.env.SENTRY_ENVIRONMENT || 'production',
    },
  };
  const envelope = [
    JSON.stringify({ event_id: event.event_id, sent_at: timestamp, dsn }),
    JSON.stringify({ type: 'event', content_type: 'application/json' }),
    JSON.stringify(event),
    '',
  ].join('\n');
  const endpoint = new URL(`/api/${projectId}/envelope/`, parsed.origin);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=must-booking-deploy/1.0, sentry_key=${parsed.username}`,
    },
    body: envelope,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Sentry rejected the operational alert (${response.status}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const source = args.at(args.indexOf('--source') + 1);
  const message = args.at(args.indexOf('--message') + 1);
  if (!source || !message) {
    console.error('Usage: report-operational-alert.mjs --source deploy-drift|deploy-preflight --message TEXT');
    process.exitCode = 2;
  } else {
    try {
      await reportOperationalAlert(source, message);
      console.log(`Reported ${source} operational alert to Sentry.`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
