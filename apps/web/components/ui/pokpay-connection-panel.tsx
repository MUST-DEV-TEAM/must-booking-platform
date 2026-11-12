import { Badge } from './badge';
import { Button } from './button';
import { FormSection } from './form-section';
import { PaymentModeBadge } from './payment-mode-badge';

export type PokpayConnection = {
  id: string;
  status: 'PENDING' | 'CONNECTED' | 'FAILED';
  /** TEST or LIVE, from the account's own keys. */
  mode?: 'TEST' | 'LIVE' | null;
};

/**
 * The PokPay account this hotel uses, as seen from its payment settings. Accounts are added, verified,
 * given new keys and switched between test and live in Settings > Integrations, the one place that
 * handles payment keys; this panel links there.
 */
export function PokpayConnectionPanel({
  connection,
  assigned,
  manageHref,
}: {
  connection?: PokpayConnection;
  assigned: boolean;
  /** Integrations settings, for people who may manage payment accounts. */
  manageHref?: string;
}) {
  const inUse = connection && assigned ? connection : undefined;
  return (
    <FormSection
      title="PokPay"
      description="Online card payments through the hotel's own PokPay account."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {inUse?.mode ? <PaymentModeBadge mode={inUse.mode} /> : null}
          <p className="m-0 text-sm font-medium">
            {!inUse
              ? 'Not connected'
              : inUse.status === 'FAILED'
                ? 'Needs attention'
                : inUse.status === 'CONNECTED'
                  ? 'Connected'
                  : 'Not verified yet'}
          </p>
          {inUse ? <Badge variant="outline">In use for this hotel</Badge> : null}
        </div>
        {manageHref ? (
          <Button variant="outline" asChild>
            <a href={manageHref}>{inUse ? 'Manage PokPay accounts' : 'Set up PokPay'}</a>
          </Button>
        ) : null}
      </div>
      <p className="m-0 text-sm text-muted-foreground">
        {!inUse
          ? 'No PokPay account is switched on for this hotel.'
          : inUse.mode === 'TEST'
            ? 'Test account: card payments are test payments, not real money.'
            : 'Live account: guests pay real money.'}
        {manageHref
          ? ' Add accounts, replace keys and switch between test and live in Integrations.'
          : ''}
      </p>
    </FormSection>
  );
}
