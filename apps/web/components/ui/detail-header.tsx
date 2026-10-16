import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from './button';
import { Card, CardContent } from './card';
import { CopyButton } from './copy-button';
import { IconButton } from './icon-button';

/**
 * Top card of a detail page: back link, reference with a copy button, big title, one-line
 * summary, status badges on the right, actions underneath on the right, and optional
 * previous / next arrows to move through the list the user came from.
 */
export function DetailHeader({
  backHref,
  backLabel,
  reference,
  title,
  subtitle,
  badges,
  actions,
  pager,
}: {
  backHref: string;
  backLabel: string;
  reference?: string;
  title: string;
  subtitle?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  pager?: { position: number; total: number; previousHref?: string; nextHref?: string };
}) {
  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Button variant="link" size="sm" asChild className="h-auto !px-0 py-0 text-xs">
              <a href={backHref}>
                <ArrowLeft aria-hidden="true" className="size-3.5" /> {backLabel}
              </a>
            </Button>
            {reference ? (
              <div className="flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                {reference}
                <CopyButton value={reference} label="Copy reference" />
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {pager ? (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <span>
                  {pager.position} of {pager.total}
                </span>
                {pager.previousHref ? (
                  <IconButton label="Previous reservation" asChild>
                    <a href={pager.previousHref}>
                      <ChevronLeft aria-hidden="true" />
                    </a>
                  </IconButton>
                ) : (
                  <IconButton label="Previous reservation" disabled>
                    <ChevronLeft aria-hidden="true" />
                  </IconButton>
                )}
                {pager.nextHref ? (
                  <IconButton label="Next reservation" asChild>
                    <a href={pager.nextHref}>
                      <ChevronRight aria-hidden="true" />
                    </a>
                  </IconButton>
                ) : (
                  <IconButton label="Next reservation" disabled>
                    <ChevronRight aria-hidden="true" />
                  </IconButton>
                )}
              </div>
            ) : null}
            {badges}
          </div>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <h2 className="m-0 text-3xl font-extrabold tracking-tight">{title}</h2>
            {subtitle ? <p className="m-0 text-sm text-muted-foreground">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}
