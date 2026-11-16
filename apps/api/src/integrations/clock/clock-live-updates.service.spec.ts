import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ClockLiveUpdatesService,
  liveUpdatesOrigin,
  topicOfSubscription,
} from './clock-live-updates.service';

const ARN = 'arn:aws:sns:eu-west-1:006467213368:PUSH_1_HOTEL:11111111-2222-3333-4444-555555555555';
const TOPIC = 'arn:aws:sns:eu-west-1:006467213368:PUSH_1_HOTEL';
const ENDPOINT = 'https://booking.example.com/clock-webhooks/public-id';
const credentials = {
  host: 'clock.example.com',
  accountId: '1',
  subscriptionId: '2',
  apiUser: 'user',
  apiKey: 'secret',
};
const found = (extra: Record<string, unknown> = {}) => ({
  status: 200,
  body: { subscription_arn: ARN, endpoint: ENDPOINT, pending_confirmation: false, ...extra },
});
const none = { status: 400, body: { error: 'webhook_subscription_not_found' } };

type Reply = { status: number; body?: unknown };

function setup(options: {
  record?: Record<string, string>;
  responses: Reply[];
  updateApplies?: boolean;
}) {
  const record = options.record ?? { ...credentials };
  const cipher = {
    encrypt: vi.fn((value: Record<string, string>) => `enc:${JSON.stringify(value)}`),
    decrypt: vi.fn((value: string) =>
      value.startsWith('enc:') ? JSON.parse(value.slice(4)) : { ...record },
    ),
  };
  const responses = [...options.responses];
  const sent: string[] = [];
  const client = {
    request: vi.fn(async (_credentials: unknown, call: { method: string }) => {
      sent.push(call.method);
      return responses.shift() ?? found();
    }),
  };
  let updates = 0;
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('UPDATE integration_connections')) {
        updates += 1;
        return options.updateApplies === false ? [] : [{ id: 'c1' }];
      }
      return [
        { provider: 'CLOCK_PMS', encryptedCredentials: 'stored', webhookPublicId: 'public-id' },
      ];
    }),
  };
  const audit = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  const service = new ClockLiveUpdatesService(
    { withTenantTransaction: vi.fn(async (_context, run) => run(tx)) } as never,
    cipher as never,
    client as never,
    audit as never,
  );
  return { service, client, audit, sent, updates: () => updates };
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('WEB_APP_URL', 'https://booking.example.com');
});
afterEach(() => vi.unstubAllEnvs());

describe('where live updates may be set up', () => {
  it('accepts only a real public https address', () => {
    expect(liveUpdatesOrigin({ WEB_APP_URL: 'https://booking.must.al' } as never)).toBe(
      'https://booking.must.al',
    );
    for (const bad of [
      'http://booking.must.al',
      'https://localhost:3001',
      'https://127.0.0.1',
      'https://10.0.0.5',
      'https://app.local',
      'https://web',
      '',
    ])
      expect(liveUpdatesOrigin({ WEB_APP_URL: bad } as never)).toBeNull();
    expect(
      liveUpdatesOrigin({ WEB_APP_URL: 'https://booking.must.al', NODE_ENV: 'test' } as never),
    ).toBeNull();
  });

  it('never subscribes from a test or local run', async () => {
    vi.stubEnv('WEB_APP_URL', 'http://localhost:3001');
    const { service, client } = setup({ responses: [none] });

    expect(await service.enable('t1', 'c1', 'u1')).toMatchObject({ state: 'not_public' });
    expect(client.request).not.toHaveBeenCalled();
  });

  it('keeps the topic as the first six parts of the subscription id', () => {
    expect(topicOfSubscription(ARN)).toBe(TOPIC);
  });
});

describe('turning on live updates for a Clock connection', () => {
  it('creates the subscription, pins the topic, sends it again and checks it', async () => {
    const { service, sent, updates, audit } = setup({
      responses: [
        none,
        { status: 200 },
        found({ pending_confirmation: true }),
        { status: 200 },
        found(),
      ],
    });

    expect(await service.enable('t1', 'c1', 'u1')).toMatchObject({ state: 'enabled' });
    expect(sent).toEqual(['GET', 'POST', 'GET', 'POST', 'GET']);
    expect(updates()).toBe(1);
    expect(audit.recordInTransaction).toHaveBeenCalledTimes(1);
  });

  it('does nothing when it is already on and pinned', async () => {
    const { service, sent, updates } = setup({
      record: { ...credentials, snsTopicArn: TOPIC },
      responses: [found(), found()],
    });

    expect(await service.enable('t1', 'c1', 'u1')).toMatchObject({ state: 'enabled' });
    expect(sent).toEqual(['GET', 'GET']);
    expect(updates()).toBe(0);
  });

  it('stops quietly when Clock has not granted the right', async () => {
    const { service, sent, updates } = setup({ responses: [{ status: 403 }] });

    expect(await service.enable('t1', 'c1', 'u1')).toMatchObject({ state: 'not_allowed' });
    expect(sent).toEqual(['GET']);
    expect(updates()).toBe(0);
  });

  it('stops when creating is refused for lack of the right', async () => {
    const { service, updates } = setup({ responses: [none, { status: 403 }] });

    expect(await service.enable('t1', 'c1', 'u1')).toMatchObject({ state: 'not_allowed' });
    expect(updates()).toBe(0);
  });

  it('changes nothing when a subscription points at another address', async () => {
    const { service, sent, updates } = setup({
      responses: [found({ endpoint: 'https://old-host.example.com/clock-webhooks/x' })],
    });

    expect(await service.enable('t1', 'c1', 'u1')).toMatchObject({ state: 'endpoint_differs' });
    expect(sent).toEqual(['GET']);
    expect(updates()).toBe(0);
  });

  it('reports a failure, and does not send again, when the credentials changed meanwhile', async () => {
    const { service, sent } = setup({
      responses: [found({ pending_confirmation: true })],
      updateApplies: false,
    });

    expect(await service.enable('t1', 'c1', 'u1')).toMatchObject({ state: 'failed' });
    expect(sent).toEqual(['GET']);
  });

  it('says so when Clock has not confirmed yet', async () => {
    const { service } = setup({
      record: { ...credentials, snsTopicArn: TOPIC },
      responses: [
        found({ pending_confirmation: true }),
        { status: 200 },
        found({ pending_confirmation: true }),
      ],
    });

    expect(await service.enable('t1', 'c1', 'u1')).toMatchObject({
      state: 'pending_confirmation',
    });
  });

  it('never throws from the safe entry point', async () => {
    const { service, client } = setup({ responses: [] });
    client.request.mockRejectedValue(new Error('network down'));

    expect(await service.enableSafely('t1', 'c1', 'u1')).toMatchObject({ state: 'failed' });
  });
});
