import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { Label } from './label';

/** A label above a control, with optional help text and an error line under it. */
export function FormField({
  label,
  htmlFor,
  required = false,
  hint,
  error,
  children,
  className,
  layout = 'stack',
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
  layout?: 'stack' | 'toggle';
}) {
  return (
    <div
      className={cn(
        layout === 'toggle'
          ? 'grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1.5 [&>[data-slot=switch]]:col-start-2 [&>[data-slot=switch]]:row-start-1 [&>[data-slot=switch]]:mt-0.5 [&>p]:col-start-1 [&>p]:row-start-2 [&>[data-slot=badge]]:col-start-1 [&>[data-slot=badge]]:row-start-3'
          : 'flex min-w-0 flex-col gap-1.5',
        className,
      )}
    >
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {children}
      {error ? (
        <p role="alert" className="m-0 text-xs font-semibold text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="m-0 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
