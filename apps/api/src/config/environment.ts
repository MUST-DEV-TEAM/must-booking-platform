export interface Environment {
  APP_PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  WEB_APP_URL: string;
  INTEGRATION_CREDENTIALS_KEY: string;
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  RESEND_API_KEY?: string;
  RESEND_API_BASE_URL?: string;
  RESEND_WEBHOOK_SECRET?: string;
  MAIL_FROM_EMAIL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  POKPAY_KEY_ID?: string;
  POKPAY_KEY_SECRET?: string;
  POKPAY_MERCHANT_ID?: string;
  POKPAY_WEBHOOK_URL?: string;
  POKPAY_API_BASE_URL?: string;
}

const requiredEnvironmentVariables = [
  'APP_PORT',
  'DATABASE_URL',
  'REDIS_URL',
  'WEB_APP_URL',
  'INTEGRATION_CREDENTIALS_KEY',
] as const;

const mailFromAddressPattern =
  /^(?:[^<>@]+<[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)$/;

function isSet(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Mail settings are optional at boot (the app runs without email), but a host that is missing
 * them silently drops every booking/staff/auth email. Callers log these at startup.
 */
export function missingMailConfiguration(
  config: Record<string, string | undefined> = process.env,
): Array<'RESEND_API_KEY' | 'MAIL_FROM_EMAIL'> {
  return (['RESEND_API_KEY', 'MAIL_FROM_EMAIL'] as const).filter((name) => !isSet(config[name]));
}

export function validateEnvironment(config: Record<string, unknown>): Record<string, unknown> {
  const missingVariables = requiredEnvironmentVariables.filter((name) => {
    const value = config[name];

    return typeof value !== 'string' || value.trim() === '';
  });

  if (missingVariables.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missingVariables.join(', ')}`);
  }

  const appPort = Number(config.APP_PORT);

  if (!Number.isInteger(appPort) || appPort < 1 || appPort > 65_535) {
    throw new Error('APP_PORT must be an integer between 1 and 65535.');
  }

  assertUrl(config.DATABASE_URL, 'DATABASE_URL', ['postgres:', 'postgresql:']);
  assertUrl(config.REDIS_URL, 'REDIS_URL', ['redis:', 'rediss:']);
  assertUrl(config.WEB_APP_URL, 'WEB_APP_URL', ['http:', 'https:']);
  assertBase64Key32Bytes(config.INTEGRATION_CREDENTIALS_KEY, 'INTEGRATION_CREDENTIALS_KEY');
  if (isSet(config.RESEND_API_BASE_URL))
    assertUrl(config.RESEND_API_BASE_URL, 'RESEND_API_BASE_URL', ['http:', 'https:']);
  if (
    isSet(config.MAIL_FROM_EMAIL) &&
    !mailFromAddressPattern.test(String(config.MAIL_FROM_EMAIL).trim())
  )
    throw new Error('MAIL_FROM_EMAIL must be an email address, optionally as "Name <address>".');

  return {
    ...config,
    APP_PORT: appPort,
  };
}

function assertBase64Key32Bytes(value: unknown, variableName: string): void {
  const decoded = Buffer.from(String(value), 'base64');
  if (decoded.length !== 32) {
    throw new Error(`${variableName} must decode (base64) to exactly 32 bytes.`);
  }
}

function assertUrl(value: unknown, variableName: string, allowedProtocols: string[]): void {
  try {
    const url = new URL(String(value));

    if (!allowedProtocols.includes(url.protocol)) {
      throw new Error();
    }
  } catch {
    throw new Error(`${variableName} must be a valid ${allowedProtocols.join(' or ')} URL.`);
  }
}
