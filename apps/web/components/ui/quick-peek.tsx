'use client';

import type { ReactNode } from 'react';

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './sheet';

/**
 * The right-hand panel that opens when a table row is clicked: a title, who or what it is, badges,
 * sections of details, and a row of buttons at the bottom to go deeper. Children are the sections.
 */
export function QuickPeek({
  open,
  onClose,
  title,
  description,
  badges,
  actions,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  badges?: ReactNode;
  /** Buttons shown at the bottom, usually a primary link and a few outline ones. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          {description ? <SheetDescription>{description}</SheetDescription> : null}
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          {badges ? <div className="flex flex-wrap items-center gap-2">{badges}</div> : null}
          {children}
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
