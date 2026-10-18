'use client';

import { Star } from 'lucide-react';

import { Badge } from './badge';
import { Button } from './button';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

/** Compact, accessible indicator for the photo guests see first. */
export function PrimaryPhotoBadge({ className }: { className?: string }) {
  return (
    <Badge variant="success" className={className} aria-label="Primary photo" title="Primary photo">
      <Star aria-hidden="true" className="size-3" fill="currentColor" />
    </Badge>
  );
}

/** Icon-only control for choosing the photo guests see first. */
export function PrimaryPhotoButton({
  primary,
  photoNumber,
  pending,
  onSelect,
}: {
  primary: boolean;
  photoNumber: number;
  pending?: boolean;
  onSelect: () => void;
}) {
  const tooltip = primary ? 'Primary photo' : 'Set as primary photo';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" title={tooltip}>
          <Button
            type="button"
            size="icon-sm"
            variant={primary ? 'secondary' : 'outline'}
            aria-label={primary ? 'Primary photo' : `Set photo ${photoNumber} as primary photo`}
            aria-pressed={primary}
            disabled={primary || pending}
            onClick={onSelect}
          >
            <Star aria-hidden="true" fill={primary ? 'currentColor' : 'none'} />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}
