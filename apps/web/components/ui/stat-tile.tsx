import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { Card } from './card';

/**
 * A card with a label, one big number and an optional note. Pass `onClick` to make it a filter
 * button (the active one is highlighted). No trend or "vs yesterday" slot on purpose: nothing
 * stores history yet (see Milestone 24, gap G1).
 */
export function StatTile({
  label,
  value,
  note,
  icon: Icon,
  tone = 'default',
  active = false,
  size = 'lg',
  href,
  onClick,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon?: LucideIcon;
  tone?: 'default' | 'warning' | 'danger' | 'success';
  active?: boolean;
  /** `sm` for text values such as dates and names; `lg` for numbers. */
  size?: 'sm' | 'lg';
  /** Makes the tile a link (for tiles that open a filtered list). */
  href?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between text-sm font-semibold text-muted-foreground">
        {label}
        {Icon ? (
          <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-primary">
            <Icon aria-hidden="true" className="size-4" />
          </span>
        ) : null}
      </div>
      <div
        className={cn(
          size === 'sm' ? 'text-lg leading-tight font-bold' : 'text-2xl font-extrabold tracking-tight',
          tone === 'warning' && 'text-warning',
          tone === 'danger' && 'text-destructive',
          tone === 'success' && 'text-success',
        )}
      >
        {value}
      </div>
      {note ? <div className="text-xs text-muted-foreground">{note}</div> : null}
    </>
  );
  if (href)
    return (
      <a
        href={href}
        className="block rounded-xl text-inherit no-underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Card className="gap-2 px-5 py-4 transition-colors hover:bg-muted/40">{body}</Card>
      </a>
    );
  if (!onClick) return <Card className="gap-2 px-5 py-4">{body}</Card>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="block w-full rounded-xl border-0 bg-transparent p-0 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Card className={cn('gap-2 px-5 py-4 transition-colors hover:bg-muted/40', active && 'border-primary bg-secondary/40')}>
        {body}
      </Card>
    </button>
  );
}
