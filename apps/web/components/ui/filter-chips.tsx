import { X } from 'lucide-react';

import { Badge } from './badge';

export type FilterChip = { key: string; label: string };

/** Removable tags that show the active filters. Renders nothing when there are none. */
export function FilterChips({
  chips,
  onRemove,
  onClearAll,
}: {
  chips: readonly FilterChip[];
  onRemove: (key: string) => void;
  onClearAll?: () => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Active filters" role="group">
      {chips.map((chip) => (
        <Badge key={chip.key} variant="secondary" className="gap-1.5 py-1 pr-1 pl-2.5">
          {chip.label}
          <button
            type="button"
            aria-label={`Remove filter ${chip.label}`}
            onClick={() => onRemove(chip.key)}
            className="flex size-4 items-center justify-center rounded-full outline-none hover:bg-background/60 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </Badge>
      ))}
      {onClearAll ? (
        <button
          type="button"
          onClick={onClearAll}
          className="text-xs font-semibold text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}
