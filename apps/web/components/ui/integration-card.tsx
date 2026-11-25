import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { Badge } from './badge';
import { Card, CardContent, CardHeader } from './card';

/**
 * One integration card. Every integration (a property system, a payment provider, the website, the restaurant)
 * uses it, so the cards line up: the same picture area, the same rows in the same order, and the buttons always at
 * the bottom of an equally tall card.
 */
export function IntegrationCard({
  header,
  headerClassName,
  title,
  badges,
  role,
  owns,
  health,
  footer,
}: {
  /** The logo or icon in the picture area. */
  header: ReactNode;
  headerClassName?: string;
  /** The connection's name, or the integration's own name before it is connected. */
  title: string;
  /** Status next to the title: whether it is on, and a Test or Live badge. */
  badges: ReactNode;
  role: string;
  owns: string;
  /** One short line about whether it works. */
  health: ReactNode;
  /** The buttons: Details first, then the main action. */
  footer: ReactNode;
}) {
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader
        className={cn(
          'flex h-32 shrink-0 items-center justify-center',
          headerClassName ?? 'bg-muted/30',
        )}
      >
        {header}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 pt-4">
        <div className="flex items-start justify-between gap-2">
          <p className="m-0 min-w-0 flex-1 truncate text-sm font-semibold">{title}</p>
          <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">{badges}</span>
        </div>
        <div className="space-y-1.5">
          <Badge variant="outline">{role}</Badge>
          <p className="m-0 line-clamp-2 min-h-8 text-xs text-muted-foreground">Owns: {owns}</p>
        </div>
        <div className="min-h-10 text-xs">{health}</div>
        <div className="mt-auto grid grid-cols-2 gap-2 pt-1">{footer}</div>
      </CardContent>
    </Card>
  );
}
