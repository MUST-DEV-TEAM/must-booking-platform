import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Deletes everything under a test tenant, in FK-safe order (verified against
 * the live schema's actual foreign-key graph, not hand-traced). Add new
 * tables here once, instead of copy-pasting a DELETE list into every new e2e
 * spec file. Does not delete `users`/`plans` rows, since those are shared
 * outside the tenant scope and each spec file already tracks its own
 * user/plan ids to clean up separately. Accepts either a plain client or a
 * `$transaction` callback's client, since some spec files wrap cleanup in a
 * transaction for atomicity.
 */
export async function cleanupTenant(
  admin: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  await admin.$executeRaw`DELETE FROM property_integration_connections WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM integration_connections WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM payment_provider_sessions WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM payments WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM property_staff_capability_overrides WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM property_role_template_capabilities WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM room_type_amenities WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM room_type_images WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM room_price_overrides WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM rate_rules WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM room_availability WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM availability_block_room_types WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM availability_block_rooms WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM inventory_units WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM notifications WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM integration_operations WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM audit_logs WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM bookings WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM availability_blocks WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM property_staff_assignments WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM rate_plans WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM rooms WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM guests WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM room_types WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM capabilities WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM property_role_templates WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM amenities WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM tenant_memberships WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM properties WHERE tenant_id = ${tenantId}::uuid`;
  await admin.$executeRaw`DELETE FROM organizations WHERE id = ${tenantId}::uuid`;
}
