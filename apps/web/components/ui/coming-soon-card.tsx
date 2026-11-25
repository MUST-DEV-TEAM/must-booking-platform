import type { ReactNode } from 'react';

import { Badge } from './badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';

/**
 * A screen that is designed but not working yet. It says plainly what it will do, can show a labelled
 * example, and has no buttons: nothing here pretends to work.
 */
export function ComingSoonCard({
  title,
  description,
  bullets,
  example,
  children,
}: {
  title: string;
  description: ReactNode;
  /** What the owner will be able to do once it works. */
  bullets?: readonly string[];
  /** A short label for the example below ("Example, not active"). */
  example?: string;
  /** The example itself (a table, a list of rows). */
  children?: ReactNode;
}) {
  return (
    <Card className="border-dashed bg-muted/30">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">{title}</CardTitle>
          <Badge variant="muted">Coming soon</Badge>
        </div>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {bullets?.length ? (
          <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
            {bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        ) : null}
        {children ? (
          <div className="flex flex-col gap-2" aria-label={example ?? 'Example'}>
            <p className="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {example ?? 'Example, not active'}
            </p>
            <div className="rounded-lg border bg-card p-3 text-sm opacity-90">{children}</div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
