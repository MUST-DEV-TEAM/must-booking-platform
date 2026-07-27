import { SetMetadata } from '@nestjs/common';

export const REQUIRED_CAPABILITY = 'required-capability';
export const RequiresCapability = (capability: string): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_CAPABILITY, capability);
