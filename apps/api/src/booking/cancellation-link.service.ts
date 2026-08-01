import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

type CancellationPayload = {
  version: 1;
  tenantId: string;
  propertyId: string;
  bookingId: string;
  guestSessionId: string;
  expiresAt: string;
};

@Injectable()
export class CancellationLinkService {
  create(
    input: Omit<CancellationPayload, 'version' | 'expiresAt'>,
    ttlSeconds = 30 * 24 * 60 * 60,
    expiresAt?: string,
  ): string {
    const payload: CancellationPayload = {
      version: 1,
      ...input,
      expiresAt: expiresAt ?? new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${encoded}.${this.sign(encoded)}`;
  }

  verify(
    token: string | undefined,
    expected: Pick<CancellationPayload, 'tenantId' | 'propertyId' | 'bookingId'>,
  ): CancellationPayload {
    if (!token) throw new BadRequestException('A cancellation link is required.');
    const [encoded, signature, extra] = token.split('.');
    if (!encoded || !signature || extra || !this.equals(signature, this.sign(encoded)))
      throw new BadRequestException('The cancellation link is invalid.');
    try {
      const value = JSON.parse(
        Buffer.from(encoded, 'base64url').toString('utf8'),
      ) as Partial<CancellationPayload>;
      if (
        value.version !== 1 ||
        typeof value.guestSessionId !== 'string' ||
        typeof value.expiresAt !== 'string'
      )
        throw new Error('invalid');
      if (new Date(value.expiresAt).valueOf() <= Date.now())
        throw new BadRequestException('The cancellation link has expired.');
      if (
        value.tenantId !== expected.tenantId ||
        value.propertyId !== expected.propertyId ||
        value.bookingId !== expected.bookingId
      )
        throw new BadRequestException('The cancellation link does not match this booking.');
      return value as CancellationPayload;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException('The cancellation link is invalid.');
    }
  }

  private sign(encoded: string): string {
    return createHmac('sha256', this.secret()).update(encoded).digest('base64url');
  }
  private equals(left: string, right: string): boolean {
    const a = Buffer.from(left),
      b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  private secret(): string {
    const configured = process.env.CANCELLATION_SIGNING_SECRET || process.env.QUOTE_SIGNING_SECRET;
    if (configured) return configured;
    if (process.env.NODE_ENV === 'production')
      throw new Error('CANCELLATION_SIGNING_SECRET must be configured in production.');
    return 'must-booking-local-cancellation-signing-secret';
  }
}
