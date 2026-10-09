// A DSN only says where to send error reports; it is not a secret (it ships in the
// browser bundle). An unset build secret arrives as an empty string, so `||` rather
// than `??` decides when to fall back to the production `must-web` project.
const PRODUCTION_WEB_DSN =
  'https://a445186a68762ee0e4560efb4bcfcfd8@o4511925476917248.ingest.de.sentry.io/4512225778466896';

export function webSentryDsn(configured: string | undefined): string | undefined {
  // Browser tests build the app in production mode; this keeps them out of the live project.
  if (process.env.NEXT_PUBLIC_SENTRY_DISABLED === 'true') return undefined;
  const dsn = configured?.trim();
  if (dsn) return dsn;
  return process.env.NODE_ENV === 'production' ? PRODUCTION_WEB_DSN : undefined;
}
