import { randomUUID } from 'node:crypto';

type Executor = {
  $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
};

/** Connects Stripe and PokPay (fixture credentials, never decrypted) so a booking may choose either method. */
export async function connectPaymentProviders(
  admin: Executor,
  tenantId: string,
  propertyId: string,
  providers: Array<'STRIPE' | 'POKPAY'> = ['STRIPE', 'POKPAY'],
): Promise<void> {
  for (const provider of providers) {
    const id = randomUUID();
    await admin.$executeRaw`INSERT INTO integration_connections(id,tenant_id,kind,provider,name,encrypted_credentials,status)
      VALUES(${id}::uuid,${tenantId}::uuid,'PAYMENT',${provider}::"IntegrationProvider",${'Test ' + provider},'fixture-never-decrypted','CONNECTED')`;
    await admin.$executeRaw`INSERT INTO property_integration_connections(tenant_id,property_id,connection_id,kind)
      VALUES(${tenantId}::uuid,${propertyId}::uuid,${id}::uuid,'PAYMENT')`;
  }
}
