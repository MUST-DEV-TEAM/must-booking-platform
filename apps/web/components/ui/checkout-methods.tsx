'use client';

import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { Badge } from './badge';
import { IconButton } from './icon-button';
import { Switch } from './switch';

export type CheckoutMethodRow = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  /** The id of the on/off switch. */
  switchId: string;
  /** Status next to the name, such as "Connected to this hotel" or a Test badge. */
  badges?: ReactNode;
  /** A link or button under the description, such as "Connect in Integrations". */
  action?: ReactNode;
  /** Settings that belong to this method, shown full width under its row while it is on. */
  details?: ReactNode;
};

/**
 * The checkout methods in the order guests see them: each row has an on/off switch, a "Default" choice and
 * move up / move down buttons (keyboard friendly, no dragging needed). A method that is not available yet
 * (`soon`) is listed under the others, greyed out.
 */
export function CheckoutMethods({
  rows,
  defaultKey,
  onToggle,
  onMove,
  onDefault,
  disabled = false,
  soon = [],
}: {
  rows: readonly CheckoutMethodRow[];
  /** The method that is pre-selected for guests. */
  defaultKey: string | null;
  onToggle: (key: string, enabled: boolean) => void;
  onMove: (key: string, direction: -1 | 1) => void;
  onDefault: (key: string) => void;
  disabled?: boolean;
  soon?: ReadonlyArray<{ key: string; label: string; description: string }>;
}) {
  return (
    <div role="group" aria-label="Default payment method" className="flex flex-col gap-2">
      {rows.map((row, index) => (
        <div
          key={row.key}
          className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3"
        >
          <span
            aria-hidden="true"
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold"
          >
            {index + 1}
          </span>
          <div className="min-w-48 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{row.label}</span>
              {row.badges}
            </div>
            <p className="m-0 text-sm text-muted-foreground">{row.description}</p>
            {row.action ? <div className="mt-2">{row.action}</div> : null}
          </div>
          <button
            type="button"
            aria-pressed={defaultKey === row.key}
            aria-label={`Make ${row.label} the default`}
            disabled={disabled || !row.enabled}
            onClick={() => onDefault(row.key)}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50',
              defaultKey === row.key
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {defaultKey === row.key ? <Check aria-hidden="true" className="size-3.5" /> : null}
            {defaultKey === row.key ? 'Default' : 'Set as default'}
          </button>
          <div className="flex items-center gap-1">
            <IconButton
              label={`Move ${row.label} up`}
              disabled={disabled || index === 0}
              onClick={() => onMove(row.key, -1)}
            >
              <ChevronUp aria-hidden="true" />
            </IconButton>
            <IconButton
              label={`Move ${row.label} down`}
              disabled={disabled || index === rows.length - 1}
              onClick={() => onMove(row.key, 1)}
            >
              <ChevronDown aria-hidden="true" />
            </IconButton>
          </div>
          <Switch
            id={row.switchId}
            aria-label={`${row.label} on or off`}
            checked={row.enabled}
            disabled={disabled}
            onCheckedChange={(checked) => onToggle(row.key, checked)}
          />
          {row.details ? (
            <div className="basis-full border-t pt-3 sm:pl-9">{row.details}</div>
          ) : null}
        </div>
      ))}
      {soon.map((row) => (
        <div
          key={row.key}
          className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed bg-muted/40 p-3 opacity-80"
        >
          <span aria-hidden="true" className="size-6 shrink-0" />
          <div className="min-w-48 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{row.label}</span>
              <Badge variant="muted">Soon</Badge>
            </div>
            <p className="m-0 text-sm text-muted-foreground">{row.description}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
