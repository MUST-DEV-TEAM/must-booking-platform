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
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
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
