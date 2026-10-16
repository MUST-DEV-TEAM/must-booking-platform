import type { LucideIcon } from 'lucide-react';

import { cn } from '../../lib/utils';

export type TabBarEntry = {
  id: string;
  label: string;
  /** A number shown next to the label ("Arriving today 7"). Omit when it is not known. */
  count?: number;
  icon?: LucideIcon;
  disabled?: boolean;
};

/** Underline tabs for switching a list between saved views; wraps on narrow widths. */
export function TabBar({
  tabs,
  current,
  onSelect,
  label = 'Views',
}: {
  tabs: readonly TabBarEntry[];
  current: string;
  onSelect: (id: string) => void;
  label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex flex-wrap gap-x-1 border-b">
      {tabs.map(({ id, label: text, count, icon: Icon, disabled }) => {
        const active = id === current;
        return (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onSelect(id)}
            className={cn(
              '-mb-px flex min-w-0 items-center gap-2 border-0 border-b-2 border-transparent bg-transparent px-2 py-2.5 text-sm font-semibold text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-40 sm:px-3',
              active && 'border-primary text-primary hover:text-primary',
            )}
          >
            {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
            {text}
            {count !== undefined ? (
              <span
                className={cn(
                  'rounded-full px-1.5 text-[11px] leading-5 font-bold',
                  active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
