import { FlaskConical } from 'lucide-react';

/**
 * Shown across the hotel dashboard while one of the hotel's payment methods uses its test account, so
 * nobody mistakes test payments for real money.
 */
export function TestModeBar({
  methods,
  manageHref,
}: {
  /** Names of the payment methods in test mode, for example ["PokPay"]. */
  methods: string[];
  /** Where the payment accounts are switched, for people who may switch them. */
  manageHref?: string;
}) {
  if (!methods.length) return null;
  return (
    <div
      role="status"
      data-test-mode-bar=""
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning-surface px-4 py-2 text-sm text-warning"
    >
      <p className="m-0 flex items-center gap-2 font-semibold">
        <FlaskConical aria-hidden="true" className="size-4 shrink-0" />
        {`${methods.join(' and ')} ${methods.length > 1 ? 'are' : 'is'} in test mode. Card payments made now are test payments, not real money.`}
      </p>
      {manageHref ? (
        <a className="font-semibold underline underline-offset-2" href={manageHref}>
          Payment accounts
        </a>
      ) : null}
    </div>
  );
}
