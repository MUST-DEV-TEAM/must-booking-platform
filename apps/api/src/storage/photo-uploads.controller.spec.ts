import 'reflect-metadata';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoUploadsController } from './photo-uploads.controller';
import { STORAGE_PROVIDER } from './storage.provider';
import { TenantDatabaseService } from '../tenancy/tenant-database.service';
import { TenantContextGuard } from '../tenancy/tenant-context.guard';
import { RolesGuard } from '../tenancy/roles.guard';
import { CapabilitiesGuard } from '../tenancy/capabilities.guard';
import { CapabilitiesService } from '../tenancy/capabilities.service';
import { AuthService } from '../auth/auth.service';
import { EmailVerificationGuard } from '../auth/email-verification.guard';
import { MAX_PHOTO_BYTES } from './local-storage.provider';

const tenantId = '11111111-1111-4111-8111-111111111111';
const propertyId = '22222222-2222-4222-8222-222222222222';
const key = `library/${tenantId}/${propertyId}/44444444-4444-4444-8444-444444444444.webp`;
const url = `/tenants/${tenantId}/properties/${propertyId}/photo-uploads`;

describe('authenticated photo upload HTTP endpoint', () => {
  let app: INestApplication;
  let role: string;
  let member: boolean;
  let property: boolean;
  let reservation: boolean;
  const uploadObject = vi.fn();
  const auth = { getSessionUserId: vi.fn(), isEmailVerified: vi.fn() };
  const capabilities = { effective: vi.fn() };
  const scopes: unknown[] = [];

  beforeEach(async () => {
    role = 'OWNER';
    member = true;
    property = true;
    reservation = true;
    uploadObject.mockReset().mockResolvedValue(undefined);
    auth.getSessionUserId
      .mockReset()
      .mockImplementation((cookie) => (cookie === 'valid' ? 'user-id' : undefined));
    auth.isEmailVerified.mockReset().mockResolvedValue(true);
    capabilities.effective.mockReset().mockResolvedValue(['photos.manage']);
    scopes.length = 0;
    const database = {
      withTenantTransaction: async (scope: unknown, work: (tx: unknown) => unknown) => {
        scopes.push(scope);
        return work({
          $queryRaw: async (sql: TemplateStringsArray) => {
            const query = sql.join('');
            if (query.includes('tenant_memberships')) return member ? [{ allowed: 1, role }] : [];
            if (query.includes('property_staff_assignments')) return [];
            if (query.includes('property_library_images'))
              return reservation ? [{ id: 'reservation' }] : [];
            if (query.includes('properties')) return property ? [{ allowed: 1 }] : [];
            throw new Error(`Unexpected query: ${query}`);
          },
        });
      },
    };
    const module = await Test.createTestingModule({
      controllers: [PhotoUploadsController],
      providers: [
        { provide: STORAGE_PROVIDER, useValue: { uploadObject } },
        { provide: TenantDatabaseService, useValue: database },
        { provide: AuthService, useValue: auth },
        { provide: CapabilitiesService, useValue: capabilities },
        ...[TenantContextGuard, RolesGuard, CapabilitiesGuard, EmailVerificationGuard].map(
          (guard) => ({ provide: APP_GUARD, useClass: guard }),
        ),
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterEach(async () => {
    await app.close();
  });

  function put(objectKey = key) {
    return request(app.getHttpServer())
      .put(url)
      .query({ key: objectKey })
      .set('Cookie', 'must_session=valid')
      .set('Content-Type', 'image/png');
  }

  it.each(['OWNER', 'ADMIN'])(
    'allows a verified %s and forwards bytes under the scoped reservation',
    async (value) => {
      role = value;
      await put().send(Buffer.from('photo bytes')).expect(204);
      expect(uploadObject).toHaveBeenCalledWith(key, Buffer.from('photo bytes'), 'image/png');
      expect(
        scopes.every(
          (scope) =>
            (scope as { tenantId: string; propertyId: string }).tenantId === tenantId &&
            (scope as { propertyId: string }).propertyId === propertyId,
        ),
      ).toBe(true);
    },
  );
  it('rejects an unauthenticated request', async () => {
    await request(app.getHttpServer())
      .put(url)
      .query({ key })
      .set('Content-Type', 'image/png')
      .send('x')
      .expect(401);
    expect(uploadObject).not.toHaveBeenCalled();
  });
  it.each([
    'unverified',
    'nonmember',
    'wrong property',
    'missing capability',
    'missing reservation',
  ])('rejects %s before writing', async (failure) => {
    if (failure === 'unverified') auth.isEmailVerified.mockResolvedValue(false);
    if (failure === 'nonmember') member = false;
    if (failure === 'wrong property') property = false;
    if (failure === 'missing capability') capabilities.effective.mockResolvedValue([]);
    if (failure === 'missing reservation') reservation = false;
    await put()
      .send(Buffer.from('x'))
      .expect(failure === 'missing reservation' ? 404 : 403);
    expect(uploadObject).not.toHaveBeenCalled();
  });
  it('rejects a key belonging to another tenant or property', async () => {
    await put(key.replace(tenantId, propertyId)).send(Buffer.from('x')).expect(404);
    await put(key.replace(`/${propertyId}/`, `/${tenantId}/`))
      .send(Buffer.from('x'))
      .expect(404);
    expect(uploadObject).not.toHaveBeenCalled();
  });
  it('rejects a chunked body exceeding the cap without trusting Content-Length', async () => {
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: '127.0.0.1',
          port: address.port,
          method: 'PUT',
          path: `${url}?key=${encodeURIComponent(key)}`,
          headers: {
            cookie: 'must_session=valid',
            'content-type': 'image/png',
            'transfer-encoding': 'chunked',
          },
        },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode));
        },
      );
      req.on('error', reject);
      req.end(Buffer.alloc(MAX_PHOTO_BYTES + 1));
    });
    expect(status).toBe(413);
    expect(uploadObject).not.toHaveBeenCalled();
  });
  it('rejects a non-image header before reading the stream', async () => {
    await put().set('Content-Type', 'application/octet-stream').send(Buffer.from('x')).expect(400);
    expect(uploadObject).not.toHaveBeenCalled();
  });
});
