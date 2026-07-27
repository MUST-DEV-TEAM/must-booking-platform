export interface Environment {
  APP_PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
}

const requiredEnvironmentVariables = ['APP_PORT', 'DATABASE_URL', 'REDIS_URL'] as const;

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

  return {
    ...config,
    APP_PORT: appPort,
  };
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
