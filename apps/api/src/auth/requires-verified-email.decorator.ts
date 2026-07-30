import { SetMetadata } from '@nestjs/common';

export const VERIFIED_EMAIL_REQUIRED = 'verified-email-required';
export const RequiresVerifiedEmail = (): MethodDecorator & ClassDecorator =>
  SetMetadata(VERIFIED_EMAIL_REQUIRED, true);
