import { savedTemplate, renderTemplate } from '../mail/email-templates';
import type { MailBrand } from '@must/domain-contracts';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { createClient, type RedisClientType } from 'redis';

import { TenantDatabaseService, type TenantTransaction } from './tenant-database.service';
import { AuditLogService } from './audit-log.service';
import { NotificationsService } from './notifications.service';
import { MailDeliveryService } from '../mail/mail-delivery.service';
import { renderBrandedEmail } from '../mail/email-layout';
import { loadVenuePlan, requireDining } from './venue-plan';

/** One row of the invitations list (G-85). */
export interface InvitationSummary {
  id: string;
  email: string;
  status: 'PENDING' | 'ACCEPTED' | 'WITHDRAWN' | 'EXPIRED';
  invitedByEmail: string | null;
  createdAt: string;
  expiresAt: string;
  resentAt: string | null;
  resolvedAt: string | null;
  propertyIds: string[];
}

export interface StaffInvite {
  tenantId: string;
  email: string;
  assignments: Array<{ propertyId: string; roleTemplateId: string; capabilityKeys?: string[] }>;
  venueAssignments?: Array<{ venueId: string; role: 'MANAGER' | 'HOST' }>;
  /** Hotel membership the invitee receives. Defaults to STAFF; the platform console invites owners. */
  membershipRole?: 'OWNER' | 'STAFF';
}

/** How long an invitation link works. */
const INVITATION_LIFETIME_SECONDS = 604800;

const INVITED_EMAIL_REQUIRED = 'Use the email address this invitation was sent to.';

/** Set when a platform account (not a hotel user) sends the invitation. */
export interface InviteSender {
  email: string;
  type: 'PLATFORM_ADMIN';
}

@Injectable()
export class StaffInviteService implements OnModuleDestroy {
  private readonly logger = new Logger(StaffInviteService.name);
  private readonly redis: RedisClientType;
  private connection?: Promise<RedisClientType>;
  constructor(
    @Inject(TenantDatabaseService) private readonly database: TenantDatabaseService,
    @Inject(AuditLogService) private readonly auditLogs: AuditLogService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(MailDeliveryService) private readonly delivery: MailDeliveryService,
  ) {
    this.redis = createClient({ url: process.env.REDIS_URL });
  }

  async invite(command: StaffInvite, actorUserId: string, sender?: InviteSender): Promise<string> {
    if (!command.assignments.length && !command.venueAssignments?.length)
      throw new BadRequestException('At least one hotel or restaurant assignment is required.');
    try {
      await this.database.withTenantTransaction({ tenantId: command.tenantId }, async (tx) => {
        await this.validateVenueAssignments(tx, command);
        await this.ensureStaffSeatAvailable(tx, command.tenantId, { email: command.email });
      });
    } catch (error) {
      if (error instanceof StaffSeatLimitReachedError) {
        await Promise.all(
          [...new Set(command.assignments.map((assignment) => assignment.propertyId))].map(
            (propertyId) =>
              this.notifications.record(command.tenantId, propertyId, 'STAFF_SEAT_CAP_REACHED', {
                maxStaffSeats: error.maxStaffSeats,
                staffSeats: error.staffSeats,
              }),
          ),
        );
      }
      throw error;
    }
    const token = randomBytes(32).toString('base64url');
    await this.client().then((redis) =>
      redis.set(`auth:staff-invite:${this.hash(token)}`, JSON.stringify(command), {
        EX: INVITATION_LIFETIME_SECONDS,
      }),
    );
    await this.recordInvitation(command, actorUserId, token);
    await this.auditLogs.record({
      tenantId: command.tenantId,
      actorUserId,
      actorType: sender?.type,
      action: 'staff.invite_created',
      targetType: 'staff_invitation',
      targetId: command.email.toLowerCase(),
      details: {
        propertyIds: command.assignments.map((assignment) => assignment.propertyId),
        venueIds: command.venueAssignments?.map((a) => a.venueId),
        ...(command.membershipRole === 'OWNER' ? { membershipRole: 'OWNER' } : {}),
      },
    });
    await this.sendInvitationEmailSafely(command, actorUserId, token, sender?.email);
    return token;
  }

  /**
   * Creates the account right away, for a hotel manager who chose the password himself. The
   * address counts as verified because the person adding the account vouches for it. An email that
   * already has an account is refused: setting someone else's password is not allowed, and a
   * person who already has an account joins another hotel through an invitation instead.
   */
  async createDirect(command: {
    tenantId: string;
    propertyId: string;
    actorUserId: string;
    firstName: string;
    lastName: string | null;
    email: string;
    password: string;
    roleTemplateId: string;
    extraCapabilities: string[];
    deniedCapabilities: string[];
  }): Promise<{ userId: string }> {
    const userId = randomUUID();
    const passwordHash = await bcrypt.hash(command.password, 12);
    try {
      await this.database.withTenantTransaction(
        { tenantId: command.tenantId, propertyId: command.propertyId },
        async (tx) => {
          await this.ensureStaffSeatAvailable(tx, command.tenantId, { email: command.email });
          const existing = await tx.$queryRaw<Array<{ found: number }>>`
            SELECT 1 AS found FROM "users" WHERE "email" = ${command.email}
          `;
          if (existing[0])
            throw new ConflictException(
              'That email already has an account. Send an invitation instead so they can join this hotel.',
            );
          await tx.$executeRaw`
            INSERT INTO "users" ("id", "email", "password_hash", "email_verified_at", "is_auto_provisioned", "first_name", "last_name")
            VALUES (${userId}::uuid, ${command.email}, ${passwordHash}, CURRENT_TIMESTAMP, false, ${command.firstName}, ${command.lastName})
          `;
          await tx.$executeRaw`
            INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role", "is_auto_provisioned")
            VALUES (${command.tenantId}::uuid, ${userId}::uuid, 'STAFF', false)
          `;
          const template = await tx.$queryRaw<Array<{ found: number }>>`
            SELECT 1 AS found FROM "property_role_templates"
            WHERE "tenant_id" = ${command.tenantId}::uuid AND "property_id" = ${command.propertyId}::uuid
              AND "id" = ${command.roleTemplateId}::uuid
          `;
          if (!template[0]) throw new BadRequestException('The role does not exist at this hotel.');
          await tx.$executeRaw`
            INSERT INTO "property_staff_assignments" ("tenant_id", "property_id", "user_id", "role_template_id", "created_by_user_id")
            VALUES (${command.tenantId}::uuid, ${command.propertyId}::uuid, ${userId}::uuid, ${command.roleTemplateId}::uuid, ${command.actorUserId}::uuid)
          `;
          for (const [keys, granted] of [
            [command.extraCapabilities, true],
            [command.deniedCapabilities, false],
          ] as const) {
            for (const key of keys) {
              await tx.$executeRaw`
                INSERT INTO "property_staff_capability_overrides" ("tenant_id", "property_id", "user_id", "capability_id", "granted")
                SELECT ${command.tenantId}::uuid, ${command.propertyId}::uuid, ${userId}::uuid, "id", ${granted}
                FROM "capabilities" WHERE "tenant_id" = ${command.tenantId}::uuid AND "key" = ${key}
              `;
            }
          }
          await this.auditLogs.recordInTransaction(tx, {
            tenantId: command.tenantId,
            propertyId: command.propertyId,
            actorUserId: command.actorUserId,
            action: 'staff.created',
            targetType: 'user',
            targetId: userId,
            details: { email: command.email, roleTemplateId: command.roleTemplateId },
          });
        },
      );
    } catch (error) {
      if (this.isUniqueEmailViolation(error))
        throw new ConflictException(
          'That email already has an account. Send an invitation instead so they can join this hotel.',
        );
      if (error instanceof StaffSeatLimitReachedError)
        await this.notifications.record(
          command.tenantId,
          command.propertyId,
          'STAFF_SEAT_CAP_REACHED',
          {
            maxStaffSeats: error.maxStaffSeats,
            staffSeats: error.staffSeats,
          },
        );
      throw error;
    }
    await this.sendAccountCreatedEmailSafely(command, userId);
    return { userId };
  }

  /**
   * Creates a staff account whose only access is to one restaurant (a waiter or a restaurant manager).
   * It uses the same staff seats as hotel staff. Whoever creates it hands over the password.
   */
  async createVenueDirect(command: {
    tenantId: string;
    venueId: string;
    actorUserId: string;
    firstName: string;
    lastName: string | null;
    email: string;
    password: string;
    role: 'MANAGER' | 'HOST';
  }): Promise<{ userId: string }> {
    const userId = randomUUID();
    const passwordHash = await bcrypt.hash(command.password, 12);
    const alreadyExists = () =>
      new ConflictException('That email already has an account. Send an invitation instead.');
    try {
      await this.database.withTenantTransaction({ tenantId: command.tenantId }, async (tx) => {
        await this.validateVenueAssignments(tx, {
          tenantId: command.tenantId,
          venueAssignments: [{ venueId: command.venueId, role: command.role }],
        });
        await this.ensureStaffSeatAvailable(tx, command.tenantId, { email: command.email });
        const existing = await tx.$queryRaw<Array<{ found: number }>>`
          SELECT 1 AS found FROM "users" WHERE "email" = ${command.email}
        `;
        if (existing[0]) throw alreadyExists();
        await tx.$executeRaw`
          INSERT INTO "users" ("id", "email", "password_hash", "email_verified_at", "is_auto_provisioned", "first_name", "last_name")
          VALUES (${userId}::uuid, ${command.email}, ${passwordHash}, CURRENT_TIMESTAMP, false, ${command.firstName}, ${command.lastName})
        `;
        await tx.$executeRaw`
          INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role", "is_auto_provisioned")
          VALUES (${command.tenantId}::uuid, ${userId}::uuid, 'STAFF', false)
        `;
        await tx.$executeRaw`
          INSERT INTO "venue_staff_assignments" ("tenant_id", "venue_id", "user_id", "role", "created_by_user_id")
          VALUES (${command.tenantId}::uuid, ${command.venueId}::uuid, ${userId}::uuid, ${command.role}, ${command.actorUserId}::uuid)
        `;
        await this.auditLogs.recordInTransaction(tx, {
          tenantId: command.tenantId,
          actorUserId: command.actorUserId,
          action: 'venue.staff_created',
          targetType: 'venue',
          targetId: command.venueId,
          details: { email: command.email, role: command.role },
        });
      });
    } catch (error) {
      if (this.isUniqueEmailViolation(error)) throw alreadyExists();
      throw error;
    }
    await this.sendVenueAccountCreatedEmailSafely(command, userId);
    return { userId };
  }

  private async sendVenueAccountCreatedEmailSafely(
    command: { tenantId: string; venueId: string; email: string; firstName: string },
    userId: string,
  ) {
    try {
      const [venue] = await this.database.withTenantTransaction(
        { tenantId: command.tenantId },
        (tx) =>
          tx.$queryRaw<
            Array<{ propertyId: string | null; name: string }>
          >`SELECT property_id AS "propertyId",name FROM venues WHERE tenant_id=${command.tenantId}::uuid AND id=${command.venueId}::uuid`,
      );
      if (venue?.propertyId)
        await this.sendAccountCreatedEmailSafely(
          { ...command, propertyId: venue.propertyId },
          userId,
        );
      else if (venue) {
        const signInLink = new URL('/login', process.env.WEB_APP_URL).toString();
        await this.delivery.dispatch(
          'rendered',
          {
            to: command.email,
            subject: 'Your staff account is ready',
            text: `Your restaurant staff account is ready. Ask the person who created it for your password. Sign in: ${signInLink}`,
            html: renderBrandedEmail({
              subject: 'Your staff account is ready',
              brand: { name: venue.name },
              heading: 'Your staff account is ready',
              content:
                '<p>Your restaurant staff account is ready. Ask the person who created it for your password.</p>',
              cta: { url: signInLink, label: 'Sign in' },
            }),
            idempotencyKey: `staff-account-created/${userId}`,
            eventType: 'staff.account_created',
            bookingId: null,
          },
          { tenantId: command.tenantId, propertyId: null },
        );
      }
    } catch {
      this.logger.error(`Unable to send the account-ready email for staff account ${userId}.`);
    }
  }

  /**
   * Tells a person their staff account is ready. The password is never in the email; whoever created the
   * account gives it to them. A failure here must not undo the account.
   */
  private async sendAccountCreatedEmailSafely(
    command: { tenantId: string; propertyId: string; firstName: string; email: string },
    userId: string,
  ): Promise<void> {
    try {
      const scope = { tenantId: command.tenantId, propertyId: command.propertyId };
      const signInLink = new URL('/login', process.env.WEB_APP_URL).toString();
      const work = await this.database.withTenantTransaction(scope, async (tx) => {
        const [brand] = await tx.$queryRaw<MailBrand[]>`
          SELECT name, brand_colour AS "brandColour", email_footer_text AS "emailFooterText",
            terms_url AS "termsUrl", logo_url AS "logoUrl", support_email AS "supportEmail", phone,
            public_website_origin AS "websiteUrl", address
          FROM properties WHERE tenant_id = ${command.tenantId}::uuid AND id = ${command.propertyId}::uuid
        `;
        return { brand, saved: await savedTemplate(tx, scope, 'staff_account_created') };
      });
      if (!work.brand) return;
      const message = renderTemplate('staff_account_created', work.saved, {
        hotel_name: work.brand.name,
        staff_name: command.firstName,
        staff_email: command.email,
        sign_in_link: signInLink,
      });
      await this.delivery.dispatch(
        'rendered',
        {
          to: command.email,
          subject: message.subject,
          text: `${message.text}

Sign in: ${signInLink}`,
          html: renderBrandedEmail({
            subject: message.subject,
            brand: work.brand,
            preheader: message.previewText || message.subject,
            heading: 'Your staff account is ready',
            content: message.html,
            cta: { url: signInLink, label: 'Sign in' },
          }),
          idempotencyKey: `staff-account-created/${userId}`,
          eventType: 'staff.account_created',
          bookingId: null,
        },
        scope,
      );
    } catch (error) {
      this.logger.error(
        `Unable to send the account-ready email for staff account ${userId}.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async accept(token: string, userId: string): Promise<void> {
    const invite = await this.readInvite(token);
    await this.database.withTenantTransaction({ tenantId: invite.tenantId }, async (tx) => {
      await this.ensureStaffSeatAvailable(tx, invite.tenantId, { userId });
      await this.assignInvitation(tx, invite, userId);
      // Used up only once every check passed (task 39-10b), still inside the transaction so a race rolls back.
      await this.consumeInvite(token);
      await this.markInvitation(tx, invite.tenantId, token, 'ACCEPTED');
    });
  }

  async activate(token: string, email: string, password: string): Promise<void> {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) {
      throw new BadRequestException(
        'A valid email and a password of at least 12 characters are required.',
      );
    }
    const userId = randomUUID();
    const invite = await this.readInvite(token);
    // The new account belongs to the invited address only (task 39-10b, MBA-107); a mismatch keeps the invitation.
    if (email.trim().toLowerCase() !== invite.email.trim().toLowerCase())
      throw new BadRequestException(INVITED_EMAIL_REQUIRED);
    try {
      await this.database.withTenantTransaction({ tenantId: invite.tenantId }, async (tx) => {
        await this.ensureStaffSeatAvailable(tx, invite.tenantId, { email: invite.email });
        await this.createActiveStaffInTransaction(tx, userId, invite.email, password, false);
        await this.assignInvitation(tx, invite, userId);
        await this.consumeInvite(token);
        await this.markInvitation(tx, invite.tenantId, token, 'ACCEPTED');
      });
    } catch (error: unknown) {
      if (this.isUniqueEmailViolation(error)) {
        throw new BadRequestException('This invitation requires a new user account.');
      }
      throw error;
    }
  }

  /** The invitations of one hotel group, newest first, for the team page (G-85). Never includes the secret link. */
  async list(tenantId: string): Promise<InvitationSummary[]> {
    return this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          email: string;
          status: 'PENDING' | 'ACCEPTED' | 'WITHDRAWN';
          expiresAt: Date;
          createdAt: Date;
          resentAt: Date | null;
          resolvedAt: Date | null;
          invitedByEmail: string | null;
          command: StaffInvite;
        }>
      >`
        SELECT i.id::text, i.email, i.status, i.expires_at AS "expiresAt", i.created_at AS "createdAt",
          i.resent_at AS "resentAt", i.resolved_at AS "resolvedAt", u.email AS "invitedByEmail", i.command
        FROM staff_invitations i
        LEFT JOIN users u ON u.id = i.invited_by_user_id
        WHERE i.tenant_id = ${tenantId}::uuid
        ORDER BY i.created_at DESC
        LIMIT 200`;
      const now = Date.now();
      return rows.map((row) => ({
        id: row.id,
        email: row.email,
        status:
          row.status === 'PENDING' && row.expiresAt.getTime() <= now
            ? ('EXPIRED' as const)
            : row.status,
        invitedByEmail: row.invitedByEmail,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
        resentAt: row.resentAt?.toISOString() ?? null,
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
        propertyIds: [...new Set((row.command.assignments ?? []).map((a) => a.propertyId))],
      }));
    });
  }

  /** Cancels a pending (or expired) invitation: its link stops working at once. */
  async withdraw(tenantId: string, invitationId: string, actorUserId: string): Promise<void> {
    const row = await this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ email: string; tokenHash: string }>>`
        UPDATE staff_invitations SET status = 'WITHDRAWN', resolved_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND id = ${invitationId}::uuid AND status = 'PENDING'
        RETURNING email, token_hash AS "tokenHash"`;
      return rows[0];
    });
    if (!row) throw new NotFoundException('This invitation is not waiting for an answer.');
    await this.client().then((redis) => redis.del(`auth:staff-invite:${row.tokenHash}`));
    await this.auditLogs.record({
      tenantId,
      actorUserId,
      action: 'staff.invite_withdrawn',
      targetType: 'staff_invitation',
      targetId: row.email.toLowerCase(),
      details: { invitationId },
    });
  }

  /** Sends a fresh link to the same address; the old link stops working. Works for expired ones too. */
  async resend(tenantId: string, invitationId: string, actorUserId: string): Promise<void> {
    const found = await this.database.withTenantTransaction({ tenantId }, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ command: StaffInvite; tokenHash: string }>>`
        SELECT command, token_hash AS "tokenHash" FROM staff_invitations
        WHERE tenant_id = ${tenantId}::uuid AND id = ${invitationId}::uuid AND status = 'PENDING'
        FOR UPDATE`;
      const row = rows[0];
      if (!row) return null;
      await this.ensureStaffSeatAvailable(tx, tenantId, { email: row.command.email });
      return row;
    });
    if (!found) throw new NotFoundException('This invitation is not waiting for an answer.');
    const token = randomBytes(32).toString('base64url');
    const redis = await this.client();
    await redis.del(`auth:staff-invite:${found.tokenHash}`);
    await redis.set(`auth:staff-invite:${this.hash(token)}`, JSON.stringify(found.command), {
      EX: INVITATION_LIFETIME_SECONDS,
    });
    await this.database.withTenantTransaction({ tenantId }, async (tx) => {
      await tx.$executeRaw`
        UPDATE staff_invitations
        SET token_hash = ${this.hash(token)},
          expires_at = now() + (${INVITATION_LIFETIME_SECONDS} * interval '1 second'),
          resent_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND id = ${invitationId}::uuid`;
    });
    await this.auditLogs.record({
      tenantId,
      actorUserId,
      action: 'staff.invite_resent',
      targetType: 'staff_invitation',
      targetId: found.command.email.toLowerCase(),
      details: { invitationId },
    });
    await this.sendInvitationEmailSafely(found.command, actorUserId, token);
  }

  private async recordInvitation(
    command: StaffInvite,
    actorUserId: string,
    token: string,
  ): Promise<void> {
    try {
      await this.database.withTenantTransaction({ tenantId: command.tenantId }, async (tx) => {
        await tx.$executeRaw`
          INSERT INTO staff_invitations (tenant_id, email, token_hash, command, invited_by_user_id, expires_at)
          VALUES (${command.tenantId}::uuid, ${command.email.trim().toLowerCase()}, ${this.hash(token)},
            ${JSON.stringify(command)}::jsonb,
            (SELECT id FROM users WHERE id = ${actorUserId}::uuid),
            now() + (${INVITATION_LIFETIME_SECONDS} * interval '1 second'))`;
      });
    } catch (error) {
      // The invitation itself works without its record; losing the list entry must not lose the invitation.
      this.logger.error(
        'Could not record the staff invitation for the invitations list.',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async markInvitation(
    tx: TenantTransaction,
    tenantId: string,
    token: string,
    status: 'ACCEPTED',
  ): Promise<void> {
    await tx.$executeRaw`
      UPDATE staff_invitations SET status = ${status}, resolved_at = now()
      WHERE tenant_id = ${tenantId}::uuid AND token_hash = ${this.hash(token)} AND status = 'PENDING'`;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.isOpen) await this.redis.quit();
  }

  private async client(): Promise<RedisClientType> {
    if (!this.redis.isOpen) {
      this.connection ??= this.redis.connect();
      await this.connection;
    }
    return this.redis;
  }

  private async sendInvitationEmailSafely(
    command: StaffInvite,
    actorUserId: string,
    token: string,
    senderEmail?: string,
  ): Promise<void> {
    try {
      const invitationUrl = new URL('/staff-invitation', process.env.WEB_APP_URL);
      invitationUrl.searchParams.set('token', token);
      const details = await this.database.withTenantTransaction(
        { tenantId: command.tenantId },
        async (tx) => {
          const organization = await tx.$queryRaw<
            Array<{ organizationName: string; invitedByEmail: string }>
          >`
            SELECT o.name AS "organizationName", COALESCE(${senderEmail ?? null}::text, u.email) AS "invitedByEmail"
            FROM organizations o
            LEFT JOIN users u ON u.id = ${actorUserId}::uuid
            WHERE o.id = ${command.tenantId}::uuid
          `;
          const assignments = await Promise.all(
            command.assignments.map(
              (assignment) =>
                tx.$queryRaw<Array<{ propertyName: string; roleTemplateName: string }>>`
                SELECT p.name AS "propertyName", t.name AS "roleTemplateName"
                FROM properties p
                JOIN property_role_templates t
                  ON t.tenant_id = p.tenant_id AND t.property_id = p.id
                WHERE p.tenant_id = ${command.tenantId}::uuid
                  AND p.id = ${assignment.propertyId}::uuid
                  AND t.id = ${assignment.roleTemplateId}::uuid
              `,
            ),
          );
          for (const assignment of command.venueAssignments ?? []) {
            assignments.push(
              await tx.$queryRaw<
                Array<{ propertyName: string; roleTemplateName: string }>
              >`SELECT name AS "propertyName", ${assignment.role === 'MANAGER' ? 'Restaurant Manager' : 'Waiter'}::text AS "roleTemplateName" FROM venues WHERE tenant_id=${command.tenantId}::uuid AND id=${assignment.venueId}::uuid`,
            );
          }
          if (!organization[0] || assignments.some((rows) => !rows[0]))
            throw new Error('Unable to load staff invitation email details.');
          return { organization: organization[0], assignments: assignments.map((rows) => rows[0]) };
        },
      );
      const propertyId =
        command.assignments.length === 1 ? command.assignments[0]!.propertyId : null;
      const customized = propertyId
        ? await this.database.withTenantTransaction(
            { tenantId: command.tenantId, propertyId },
            async (tx) => {
              const [brand] = await tx.$queryRaw<
                MailBrand[]
              >`SELECT name,logo_url AS "logoUrl",support_email AS "supportEmail",phone,address,public_website_origin AS "websiteUrl" FROM properties WHERE tenant_id=${command.tenantId}::uuid AND id=${propertyId}::uuid`;
              const saved = await savedTemplate(
                tx,
                { tenantId: command.tenantId, propertyId },
                'staff_invitation',
              );
              return {
                brand,
                template: renderTemplate('staff_invitation', saved, {
                  hotel_name: brand?.name ?? details.organization.organizationName,
                  staff_name: 'colleague',
                  role_name: details.assignments[0]?.roleTemplateName ?? 'staff',
                  invitation_link: invitationUrl.toString(),
                }),
              };
            },
          )
        : {};
      await this.delivery.dispatch(
        'staffInvitation',
        {
          to: command.email,
          ...customized,
          organizationName: details.organization.organizationName,
          invitedByEmail: details.organization.invitedByEmail,
          assignments: details.assignments,
          invitationUrl: invitationUrl.toString(),
        },
        { tenantId: command.tenantId, propertyId },
        { inlineFirst: true },
      );
    } catch (error) {
      this.logger.error(
        `Unable to send staff invitation email to ${command.email}; invitation remains valid.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  /** Reads an invitation without using it up, so a refused attempt leaves it valid. */
  private async readInvite(token: string): Promise<StaffInvite> {
    const value = await this.client().then((redis) =>
      redis.get(`auth:staff-invite:${this.hash(token)}`),
    );
    if (!value) throw new BadRequestException('Invalid or expired staff invitation.');
    return JSON.parse(value) as StaffInvite;
  }

  private async consumeInvite(token: string): Promise<StaffInvite> {
    const value = await this.client().then((redis) =>
      redis.getDel(`auth:staff-invite:${this.hash(token)}`),
    );
    if (!value) throw new BadRequestException('Invalid or expired staff invitation.');
    return JSON.parse(value) as StaffInvite;
  }

  private async assignInvitation(
    tx: TenantTransaction,
    invite: StaffInvite,
    userId: string,
  ): Promise<void> {
    await this.validateVenueAssignments(tx, invite);
    await this.assignStaffInTransaction(
      tx,
      invite.tenantId,
      userId,
      invite.assignments,
      false,
      invite.membershipRole === 'OWNER' ? 'OWNER' : 'STAFF',
    );
    // Every invitation belongs to the address it was sent to (task 39-10b; before, only venue invitations checked).
    // The membership makes a newly activated user visible under users RLS. A mismatch rolls back the entire transaction.
    const [user] = await tx.$queryRaw<
      Array<{ email: string }>
    >`SELECT email FROM users WHERE id=${userId}::uuid`;
    if (!user || user.email.trim().toLowerCase() !== invite.email.trim().toLowerCase())
      throw new BadRequestException(INVITED_EMAIL_REQUIRED);
    for (const assignment of invite.venueAssignments ?? []) {
      await tx.$executeRaw`INSERT INTO venue_staff_assignments(tenant_id,venue_id,user_id,role)
        VALUES(${invite.tenantId}::uuid,${assignment.venueId}::uuid,${userId}::uuid,${assignment.role})
        ON CONFLICT(tenant_id,venue_id,user_id) DO UPDATE SET role=EXCLUDED.role,updated_at=now()`;
    }
    await this.auditLogs.recordInTransaction(tx, {
      tenantId: invite.tenantId,
      actorUserId: userId,
      action: 'staff.invite_accepted',
      targetType: 'user',
      targetId: userId,
      details: {
        propertyIds: invite.assignments.map((assignment) => assignment.propertyId),
        venueIds: invite.venueAssignments?.map((a) => a.venueId),
      },
    });
  }

  private async validateVenueAssignments(
    tx: TenantTransaction,
    command: Pick<StaffInvite, 'tenantId' | 'venueAssignments'>,
  ) {
    if (!command.venueAssignments?.length) return;
    requireDining(await loadVenuePlan(tx, command.tenantId));
    for (const assignment of command.venueAssignments) {
      if (!['MANAGER', 'HOST'].includes(assignment.role))
        throw new BadRequestException('Invalid restaurant role.');
      const rows = await tx.$queryRaw<
        Array<{ id: string }>
      >`SELECT id FROM venues WHERE tenant_id=${command.tenantId}::uuid AND id=${assignment.venueId}::uuid AND active`;
      if (!rows[0])
        throw new BadRequestException('The restaurant must be active in this workspace.');
    }
  }

  private async createActiveStaffInTransaction(
    tx: TenantTransaction,
    userId: string,
    email: string,
    password: string,
    autoProvisioned: boolean,
  ): Promise<void> {
    await this.ensureTenantMembershipAllowed(tx, userId);
    await tx.$executeRaw`
      INSERT INTO "users" ("id", "email", "password_hash", "email_verified_at", "is_auto_provisioned")
      VALUES (${userId}::uuid, ${email.toLowerCase()}, ${await bcrypt.hash(password, 12)}, CURRENT_TIMESTAMP, ${autoProvisioned})
    `;
  }

  private async assignStaffInTransaction(
    tx: TenantTransaction,
    tenantId: string,
    userId: string,
    assignments: StaffInvite['assignments'],
    autoProvisioned: boolean,
    membershipRole: 'OWNER' | 'STAFF' = 'STAFF',
  ): Promise<void> {
    await this.ensureTenantMembershipAllowed(tx, userId);
    await tx.$executeRaw`
      INSERT INTO "tenant_memberships" ("tenant_id", "user_id", "role", "is_auto_provisioned")
      VALUES (${tenantId}::uuid, ${userId}::uuid, ${membershipRole}::"TenantMembershipRole", ${autoProvisioned})
      ON CONFLICT ("tenant_id", "user_id") DO NOTHING
    `;
    for (const assignment of assignments) {
      await tx.$executeRaw`
        INSERT INTO "property_staff_assignments" ("tenant_id", "property_id", "user_id", "role_template_id") VALUES (${tenantId}::uuid, ${assignment.propertyId}::uuid, ${userId}::uuid, ${assignment.roleTemplateId}::uuid)
        ON CONFLICT ("tenant_id", "property_id", "user_id") DO UPDATE SET "role_template_id" = EXCLUDED."role_template_id"
      `;
      for (const key of assignment.capabilityKeys ?? []) {
        await tx.$executeRaw`
          INSERT INTO "property_staff_capability_overrides" ("tenant_id", "property_id", "user_id", "capability_id", "granted")
          SELECT ${tenantId}::uuid, ${assignment.propertyId}::uuid, ${userId}::uuid, "id", true FROM "capabilities" WHERE "tenant_id" = ${tenantId}::uuid AND "key" = ${key}
          ON CONFLICT ("tenant_id", "property_id", "user_id", "capability_id") DO UPDATE SET "granted" = true
        `;
      }
    }
  }

  private async ensureTenantMembershipAllowed(
    tx: TenantTransaction,
    userId: string,
  ): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ isPlatformAdmin: boolean }>>`
      SELECT "auth_is_platform_admin"(${userId}::uuid) AS "isPlatformAdmin"
    `;
    if (rows[0]?.isPlatformAdmin === true) {
      throw new BadRequestException('Platform admin accounts cannot join a tenant.');
    }
  }

  private isUniqueEmailViolation(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2010' &&
      'meta' in error &&
      typeof (error as { meta?: unknown }).meta === 'object' &&
      (error as { meta?: { code?: string } }).meta?.code === '23505'
    );
  }

  private async ensureStaffSeatAvailable(
    tx: TenantTransaction,
    tenantId: string,
    invitee: { email?: string; userId?: string },
  ): Promise<void> {
    const plan = await tx.$queryRaw<Array<{ maxStaffSeats: number }>>`
      SELECT p."max_staff_seats" AS "maxStaffSeats"
      FROM "organizations" o
      JOIN "plans" p ON p."id" = o."plan_id"
      WHERE o."id" = ${tenantId}::uuid
      FOR UPDATE OF o
    `;
    if (!plan[0]) throw new BadRequestException('The tenant does not have a plan.');

    const existingMembership = invitee.userId
      ? await tx.$queryRaw<Array<{ found: boolean }>>`
          SELECT EXISTS(
            SELECT 1 FROM "tenant_memberships"
            WHERE "tenant_id" = ${tenantId}::uuid AND "user_id" = ${invitee.userId}::uuid
          ) AS "found"
        `
      : await tx.$queryRaw<Array<{ found: boolean }>>`
          SELECT EXISTS(
            SELECT 1
            FROM "tenant_memberships" tm
            JOIN "users" u ON u."id" = tm."user_id"
            WHERE tm."tenant_id" = ${tenantId}::uuid AND u."email" = ${invitee.email!.toLowerCase()}
          ) AS "found"
        `;
    if (existingMembership[0]?.found) return;

    const memberships = await tx.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::integer AS "count"
      FROM "tenant_memberships"
      WHERE "tenant_id" = ${tenantId}::uuid AND NOT "is_auto_provisioned"
    `;
    if ((memberships[0]?.count ?? 0) >= plan[0].maxStaffSeats) {
      throw new StaffSeatLimitReachedError(plan[0].maxStaffSeats, memberships[0]?.count ?? 0);
    }
  }
}

class StaffSeatLimitReachedError extends ConflictException {
  constructor(
    readonly maxStaffSeats: number,
    readonly staffSeats: number,
  ) {
    super('The current plan has reached its staff-seat limit.');
  }
}
