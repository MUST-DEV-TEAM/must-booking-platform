import { Inject, Injectable } from '@nestjs/common';
import { CredentialCipherService } from '../integrations/credential-cipher';

export type EmailCredentialScope = { tenantId: string; propertyId: string };
export type EmailCredentialBinding = { revision: string; endpoint: string };
export type EmailTransportCredentials =
  { provider: 'resend'; apiKey: string } | { provider: 'smtp'; username: string; password: string };

export class EmailTransportCredentialError extends Error {
  constructor() {
    super(
      'Sending credentials are unavailable for this hotel configuration. Replace them and verify the sender again.',
    );
    this.name = 'EmailTransportCredentialError';
  }
}

/** Scope/endpoint-bound authenticated secrets; only server transport code may decrypt them. */
@Injectable()
export class EmailTransportCredentialService {
  constructor(@Inject(CredentialCipherService) private readonly cipher: CredentialCipherService) {}
  seal(
    scope: EmailCredentialScope,
    binding: EmailCredentialBinding,
    credentials: EmailTransportCredentials,
  ): string {
    if (
      !scope.tenantId ||
      !scope.propertyId ||
      !binding.revision ||
      !binding.endpoint ||
      !this.valid(credentials)
    )
      throw new EmailTransportCredentialError();
    try {
      const secret: Record<string, string> =
        credentials.provider === 'resend'
          ? { provider: 'resend', apiKey: credentials.apiKey }
          : { provider: 'smtp', username: credentials.username, password: credentials.password };
      return this.cipher.encrypt({
        payloadKind: 'property-email-credentials-v1',
        tenantId: scope.tenantId,
        propertyId: scope.propertyId,
        revision: binding.revision,
        endpoint: binding.endpoint,
        ...secret,
      });
    } catch {
      throw new EmailTransportCredentialError();
    }
  }
  open(
    scope: EmailCredentialScope,
    binding: EmailCredentialBinding,
    encrypted: string,
  ): EmailTransportCredentials {
    try {
      const payload = this.cipher.decrypt(encrypted);
      if (
        payload.payloadKind !== 'property-email-credentials-v1' ||
        !scope.tenantId ||
        !scope.propertyId ||
        !binding.revision ||
        !binding.endpoint ||
        payload.tenantId !== scope.tenantId ||
        payload.propertyId !== scope.propertyId ||
        payload.revision !== binding.revision ||
        payload.endpoint !== binding.endpoint
      )
        throw new EmailTransportCredentialError();
      const credentials =
        payload.provider === 'resend'
          ? { provider: 'resend' as const, apiKey: payload.apiKey }
          : payload.provider === 'smtp'
            ? { provider: 'smtp' as const, username: payload.username, password: payload.password }
            : null;
      if (!credentials || !this.valid(credentials)) throw new EmailTransportCredentialError();
      return credentials;
    } catch {
      throw new EmailTransportCredentialError();
    }
  }
  private valid(credentials: EmailTransportCredentials): boolean {
    return credentials.provider === 'resend'
      ? typeof credentials.apiKey === 'string' && /^[\x21-\x7e]{1,1024}$/.test(credentials.apiKey)
      : credentials.provider === 'smtp' &&
          typeof credentials.username === 'string' &&
          credentials.username.length > 0 &&
          credentials.username.length <= 320 &&
          !/[\r\n\0]/.test(credentials.username) &&
          typeof credentials.password === 'string' &&
          credentials.password.length > 0 &&
          credentials.password.length <= 4096;
  }
}
