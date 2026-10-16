import type { ComponentProps } from 'react';

import { Button } from './button';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

/**
 * An icon-only button that shows its name in a tooltip on hover and focus. The label is also the
 * accessible name. Use for toolbar actions where text would crowd the row (Filters, Columns).
 * It forwards every prop to the button, so it works as the child of a Popover or Dropdown trigger.
 */
export function IconButton({
  label,
  hint,
  children,
  variant = 'outline',
  size = 'icon-sm',
  ...props
}: Omit<ComponentProps<typeof Button>, 'aria-label'> & {
  label: string;
  /** Extra text under the label in the tooltip, such as the current selection. */
  hint?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant={variant} size={size} aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {hint ? <span className="block opacity-80">{hint}</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}
