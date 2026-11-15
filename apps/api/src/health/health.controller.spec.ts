import { beforeEach, describe, expect, it, vi } from 'vitest';

const redis = vi.hoisted(() => ({
  ping: vi.fn(),
  connect: vi.fn(),
  quit: vi.fn(),
  on: vi.fn(),
  isOpen: false,
}));

vi.mock('redis', () => ({ createClient: () => redis }));

import { HealthController } from './health.controller';

function setup(query: () => Promise<unknown>) {
  const database = { $queryRaw: vi.fn(query) };
  const controller = new HealthController(database as never);
  const response = { status: vi.fn() };

  return { controller, response };
}

describe('HealthController', () => {
  beforeEach(() => {
    vi.useRealTimers();
    redis.isOpen = false;
    redis.connect.mockReset().mockImplementation(async () => {
      redis.isOpen = true;
    });
    redis.ping.mockReset().mockResolvedValue('PONG');
    redis.quit.mockReset().mockResolvedValue('OK');
  });

  it('answers liveness without touching dependencies', () => {
    const { controller } = setup(async () => 1);

    expect(controller.getHealth()).toEqual({ status: 'ok' });
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('is ready when the database and Redis answer', async () => {
    const { controller, response } = setup(async () => [{ '?column?': 1 }]);

    await expect(controller.getReadiness(response)).resolves.toEqual({ status: 'ok' });
    expect(response.status).not.toHaveBeenCalled();
  });

  it('answers 503 naming the database when the query fails, without error text', async () => {
    const { controller, response } = setup(async () => {
      throw new Error('password authentication failed for user must_booking_app');
    });

    const body = await controller.getReadiness(response);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(body).toEqual({ status: 'unavailable', failed: ['database'] });
    expect(JSON.stringify(body)).not.toContain('password');
  });

  it('answers 503 naming redis when the ping fails', async () => {
    redis.ping.mockRejectedValue(new Error('ECONNREFUSED redis:6379'));
    const { controller, response } = setup(async () => 1);

    const body = await controller.getReadiness(response);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(body).toEqual({ status: 'unavailable', failed: ['redis'] });
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
  });

  it('answers 503 naming redis when the ping times out', async () => {
    vi.useFakeTimers();
    redis.ping.mockReturnValue(new Promise(() => undefined));
    const { controller, response } = setup(async () => 1);

    const pending = controller.getReadiness(response);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toEqual({ status: 'unavailable', failed: ['redis'] });
    expect(response.status).toHaveBeenCalledWith(503);
  });

  it('names both parts when both fail', async () => {
    redis.ping.mockRejectedValue(new Error('down'));
    const { controller, response } = setup(async () => {
      throw new Error('down');
    });

    await expect(controller.getReadiness(response)).resolves.toEqual({
      status: 'unavailable',
      failed: ['database', 'redis'],
    });
  });

  it('closes the Redis connection on shutdown', async () => {
    const { controller, response } = setup(async () => 1);
    await controller.getReadiness(response);

    await controller.onModuleDestroy();

    expect(redis.quit).toHaveBeenCalled();
  });
});
