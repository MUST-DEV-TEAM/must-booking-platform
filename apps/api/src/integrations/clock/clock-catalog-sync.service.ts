import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { AuditLogService } from '../../tenancy/audit-log.service';
import {
  TenantDatabaseService,
  type TenantTransaction,
} from '../../tenancy/tenant-database.service';
import { IntegrationConnectionsService } from '../integration-connections.service';
import { ClockCircuitBreakerService, CircuitOpenError } from './clock-circuit-breaker';
import { parseClockCredentials } from './clock-credentials';
import {
  ClockHttpClient,
  ClockHttpError,
  type ClockConnectionCredentials,
} from './clock-http-client';
import { ClockRateLimiterService } from './clock-rate-limiter';

type ClockRoomType = { id: number | string; name: string };
type ClockRoom = { id: number | string; name: string; room_type_id: number | string };
type EntityType = 'ROOM_TYPE' | 'ROOM';
type SyncStatus = 'PROPOSED' | 'CONFIRMED' | 'REJECTED';

export interface ClockCatalogMappingRow {
  id: string;
  entityType: EntityType;
  externalEntityId: string;
  externalParentId: string | null;
  externalName: string;
  syncStatus: SyncStatus;
  localEntityId: string | null;
}

@Injectable()
export class ClockCatalogSyncService {
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(IntegrationConnectionsService)
    private readonly connections: IntegrationConnectionsService,
    @Inject(AuditLogService) private readonly audit: AuditLogService,
    @Inject(ClockHttpClient) private readonly client: ClockHttpClient,
    @Inject(ClockRateLimiterService) private readonly rateLimiter: ClockRateLimiterService,
    @Inject(ClockCircuitBreakerService) private readonly circuitBreaker: ClockCircuitBreakerService,
  ) {}

  async sync(
    tenantId: string,
    propertyId: string,
    actorUserId: string | null,
  ): Promise<{ connectionId: string; proposed: number; updated: number }> {
    const connection = await this.connections.activePmsConnectionCredentials(tenantId, propertyId);
    if (!connection || connection.provider !== 'CLOCK_PMS')
      throw new BadRequestException('This property has no active Clock PMS connection.');
    const parsed = parseClockCredentials(connection.credentials);
    if (!parsed.ok) throw new BadRequestException(parsed.message);

    const [roomTypes, rooms] = await Promise.all([
      this.fetch<ClockRoomType[]>(parsed.value, '/room_types'),
      this.fetch<ClockRoom[]>(parsed.value, '/rooms'),
    ]);

    let proposed = 0;
    let updated = 0;
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      for (const roomType of roomTypes) {
        const result = await this.upsertMapping(tx, {
          tenantId,
          propertyId,
          connectionId: connection.connectionId,
          entityType: 'ROOM_TYPE',
          externalEntityId: String(roomType.id),
          externalParentId: null,
          externalName: roomType.name,
        });
        if (result === 'inserted') proposed += 1;
        else updated += 1;
      }
      for (const room of rooms) {
        const result = await this.upsertMapping(tx, {
          tenantId,
          propertyId,
          connectionId: connection.connectionId,
          entityType: 'ROOM',
          externalEntityId: String(room.id),
          externalParentId: String(room.room_type_id),
          externalName: room.name,
        });
        if (result === 'inserted') proposed += 1;
        else updated += 1;
      }
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'clock_catalog.synced',
        targetType: 'integration_connection',
        targetId: connection.connectionId,
        details: { proposed, updated, roomTypes: roomTypes.length, rooms: rooms.length },
      });
    });

    return { connectionId: connection.connectionId, proposed, updated };
  }

  listMappings(tenantId: string, propertyId: string): Promise<ClockCatalogMappingRow[]> {
    return this.database.withTenantTransaction({ tenantId, propertyId }, (tx) =>
      tx.$queryRawUnsafe<ClockCatalogMappingRow[]>(
        `SELECT id, entity_type AS "entityType", external_entity_id AS "externalEntityId",
           external_parent_id AS "externalParentId", external_name AS "externalName",
           sync_status AS "syncStatus", local_entity_id AS "localEntityId"
         FROM clock_catalog_mappings
         WHERE tenant_id = $1::uuid AND property_id = $2::uuid
         ORDER BY entity_type, external_name`,
        tenantId,
        propertyId,
      ),
    );
  }

  async confirm(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    mappingId: string,
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const rows = await tx.$queryRawUnsafe<ClockCatalogMappingRow[]>(
        `SELECT id, entity_type AS "entityType", external_entity_id AS "externalEntityId",
           external_parent_id AS "externalParentId", external_name AS "externalName",
           sync_status AS "syncStatus", local_entity_id AS "localEntityId"
         FROM clock_catalog_mappings WHERE tenant_id = $1::uuid AND property_id = $2::uuid AND id = $3::uuid`,
        tenantId,
        propertyId,
        mappingId,
      );
      const mapping = rows[0];
      if (!mapping) throw new BadRequestException('Mapping not found.');
      if (mapping.syncStatus === 'CONFIRMED') return;

      const localId = randomUUID();
      if (mapping.entityType === 'ROOM_TYPE') {
        try {
          await tx.$executeRawUnsafe(
            `INSERT INTO room_types (id, tenant_id, property_id, name, max_occupancy)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 2)`,
            localId,
            tenantId,
            propertyId,
            mapping.externalName,
          );
        } catch (error: unknown) {
          if (this.isUniqueViolation(error))
            throw new ConflictException(
              `A room type named "${mapping.externalName}" already exists for this property. Rename or remove it before confirming this Clock mapping.`,
            );
          throw error;
        }
      } else {
        const parentRows = await tx.$queryRawUnsafe<Array<{ localEntityId: string | null }>>(
          `SELECT local_entity_id AS "localEntityId" FROM clock_catalog_mappings
           WHERE tenant_id = $1::uuid AND property_id = $2::uuid AND entity_type = 'ROOM_TYPE'
             AND external_entity_id = $3 AND sync_status = 'CONFIRMED'`,
          tenantId,
          propertyId,
          mapping.externalParentId,
        );
        const parentLocalId = parentRows[0]?.localEntityId;
        if (!parentLocalId)
          throw new BadRequestException('Confirm this room’s parent room type first.');
        try {
          await tx.$executeRawUnsafe(
            `INSERT INTO rooms (id, tenant_id, property_id, room_type_id, name)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5)`,
            localId,
            tenantId,
            propertyId,
            parentLocalId,
            mapping.externalName,
          );
        } catch (error: unknown) {
          if (this.isUniqueViolation(error))
            throw new ConflictException(
              `A room named "${mapping.externalName}" already exists for this property. Rename or remove it before confirming this Clock mapping.`,
            );
          throw error;
        }
      }

      await tx.$executeRawUnsafe(
        `UPDATE clock_catalog_mappings SET sync_status = 'CONFIRMED', local_entity_id = $2::uuid, updated_at = CURRENT_TIMESTAMP
         WHERE id = $1::uuid`,
        mappingId,
        localId,
      );
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'clock_catalog_mapping.confirmed',
        targetType: 'clock_catalog_mapping',
        targetId: mappingId,
        details: { entityType: mapping.entityType, localEntityId: localId },
      });
    });
  }

  async reject(
    tenantId: string,
    propertyId: string,
    actorUserId: string,
    mappingId: string,
  ): Promise<void> {
    await this.database.withTenantTransaction({ tenantId, propertyId }, async (tx) => {
      const updated = await tx.$executeRawUnsafe(
        `UPDATE clock_catalog_mappings SET sync_status = 'REJECTED', updated_at = CURRENT_TIMESTAMP
         WHERE tenant_id = $1::uuid AND property_id = $2::uuid AND id = $3::uuid AND sync_status = 'PROPOSED'`,
        tenantId,
        propertyId,
        mappingId,
      );
      if (updated === 0) throw new BadRequestException('Mapping not found or already decided.');
      await this.audit.recordInTransaction(tx, {
        tenantId,
        propertyId,
        actorUserId,
        action: 'clock_catalog_mapping.rejected',
        targetType: 'clock_catalog_mapping',
        targetId: mappingId,
      });
    });
  }

  private async fetch<T>(credentials: ClockConnectionCredentials, path: string): Promise<T> {
    const breakerKey = credentials.apiUser;
    try {
      this.circuitBreaker.assertClosed(breakerKey);
    } catch (error) {
      if (error instanceof CircuitOpenError) throw new BadRequestException(error.message);
      throw error;
    }
    const rateLimit = await this.rateLimiter.consume(credentials.apiUser);
    if (!rateLimit.allowed)
      throw new BadRequestException(
        `Too many Clock requests right now — try again in ${rateLimit.retryAfterSeconds}s.`,
      );
    try {
      const response = await this.client.request<T>(credentials, {
        api: 'pms_api',
        method: 'GET',
        path,
        timeoutMs: 15_000,
      });
      if (response.status < 200 || response.status >= 300) {
        this.circuitBreaker.recordFailure(breakerKey);
        throw new BadRequestException(`Clock returned status ${response.status} for ${path}.`);
      }
      this.circuitBreaker.recordSuccess(breakerKey);
      return response.body;
    } catch (error) {
      this.circuitBreaker.recordFailure(breakerKey);
      if (error instanceof ClockHttpError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  private async upsertMapping(
    tx: TenantTransaction,
    input: {
      tenantId: string;
      propertyId: string;
      connectionId: string;
      entityType: EntityType;
      externalEntityId: string;
      externalParentId: string | null;
      externalName: string;
    },
  ): Promise<'inserted' | 'updated'> {
    const rows = await tx.$queryRawUnsafe<Array<{ inserted: boolean }>>(
      `INSERT INTO clock_catalog_mappings
         (tenant_id, property_id, connection_id, entity_type, external_entity_id, external_parent_id, external_name)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::"ClockCatalogEntityType", $5, $6, $7)
       ON CONFLICT (tenant_id, connection_id, entity_type, external_entity_id)
       DO UPDATE SET external_name = $7, external_parent_id = $6, updated_at = CURRENT_TIMESTAMP
       RETURNING (xmax = 0) AS inserted`,
      input.tenantId,
      input.propertyId,
      input.connectionId,
      input.entityType,
      input.externalEntityId,
      input.externalParentId,
      input.externalName,
    );
    return rows[0]?.inserted ? 'inserted' : 'updated';
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2010' &&
      (error as { meta?: { code?: string } }).meta?.code === '23505'
    );
  }
}
