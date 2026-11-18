/** The credential fields each integration provider asks for, used by the Integrations settings. */
export type ConnectionProvider = 'STRIPE' | 'POKPAY' | 'CLOCK_PMS';

export const credentialFieldsByProvider: Record<
  ConnectionProvider,
  Array<{
    key: string;
    label: string;
    secret?: boolean;
    options?: Array<{ value: string; label: string }>;
  }>
> = {
  STRIPE: [
    { key: 'secretKey', label: 'Secret key', secret: true },
    { key: 'webhookSecret', label: 'Webhook secret', secret: true },
    { key: 'publishableKey', label: 'Publishable key' },
  ],
  POKPAY: [
    { key: 'keyId', label: 'Key ID' },
    { key: 'keySecret', label: 'Key secret', secret: true },
    { key: 'merchantId', label: 'Merchant ID' },
    {
      key: 'environment',
      label: 'Environment',
      options: [
        { value: 'staging', label: 'Staging (test payments)' },
        { value: 'production', label: 'Production (real payments)' },
      ],
    },
  ],
  CLOCK_PMS: [
    { key: 'host', label: 'Host' },
    { key: 'accountId', label: 'Subscription ID' },
    { key: 'subscriptionId', label: 'Account ID' },
    { key: 'apiUser', label: 'API user' },
    { key: 'apiKey', label: 'API key', secret: true },
  ],
};
