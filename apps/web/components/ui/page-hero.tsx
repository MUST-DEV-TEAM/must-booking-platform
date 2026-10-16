import type { ReactNode } from 'react';

import { Card, CardContent } from './card';

/** The top card of a landing page: small caption, big title, one sentence, actions and chips. */
export function PageHero({
  eyebrow,
  title,
  description,
  actions,
  chips,
}: {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  chips?: ReactNode;
}) {
  return (
    <Card className="gap-0 py-0">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            {eyebrow ? (
              <p className="m-0 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">{eyebrow}</p>
            ) : null}
            <h2 className="m-0 text-3xl font-extrabold tracking-tight">{title}</h2>
            {description ? <p className="m-0 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
        {chips ? <div className="flex flex-wrap gap-2 border-t pt-4">{chips}</div> : null}
      </CardContent>
    </Card>
  );
}
