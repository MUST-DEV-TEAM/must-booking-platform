import { SetMetadata } from '@nestjs/common';

export const SIGNUP_RATE_LIMITED = 'signup-rate-limited';
export const SignupRateLimited = (): MethodDecorator => SetMetadata(SIGNUP_RATE_LIMITED, true);
