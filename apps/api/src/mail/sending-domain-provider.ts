export type SendingDomainRecord = {
  record: string;
  name: string;
  type: string;
  value: string;
  status: string;
  ttl: string | number;
  priority?: number;
};
export type SendingDomainEvidence = {
  provider: string;
  id: string;
  name: string;
  status: string;
  verified: boolean;
  sendingEnabled: boolean;
  records: SendingDomainRecord[];
};
/** A provider supplies actual domain/DNS evidence; callers own scoped intentions and activation. */
export interface SendingDomainProvider {
  findDomain(name: string): Promise<{ id: string; name: string } | null>;
  getDomain(id: string, expectedName: string): Promise<SendingDomainEvidence>;
  createDomain(name: string): Promise<SendingDomainEvidence>;
  recheckDomain(id: string, expectedName: string): Promise<SendingDomainEvidence>;
}
export class SendingDomainProviderError extends Error {
  constructor(
    readonly uncertain: boolean,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(
      uncertain
        ? 'The domain operation outcome is unknown. Reconcile the existing domain before trying again.'
        : 'Sending-domain evidence is unavailable. Check the provider key permissions and domain setup.',
    );
    this.name = 'SendingDomainProviderError';
  }
}
