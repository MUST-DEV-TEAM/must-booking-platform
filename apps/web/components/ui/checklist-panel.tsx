import type { ReactNode } from 'react';

import { Badge } from './badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';

export type ChecklistItem = {
  key: string;
  label: string;
  detail?: ReactNode;
  status: 'done' | 'attention' | 'todo';
  /** Where to go to fix or review it. */
  href?: string;
};

const statusBadge = {
  done: { variant: 'success', label: 'Ready' },
  attention: { variant: 'warning', label: 'Needs attention' },
  todo: { variant: 'secondary', label: 'Not set' },
} as const;

/** A short list of checks, each with a status and a link to fix it. */
export function ChecklistPanel({
  title,
  description,
  items,
}: {
  title: string;
  description?: ReactNode;
  items: readonly ChecklistItem[];
}) {
  const done = items.filter((item) => item.status === 'done').length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          {title}{' '}
          <span className="text-sm font-normal text-muted-foreground">
            {done} of {items.length} ready
          </span>
        </CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((item) => {
            const badge = statusBadge[item.status];
            const row = (
              <>
                <span className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold">{item.label}</span>
                  {item.detail ? (
                    <span className="text-xs text-muted-foreground">{item.detail}</span>
                  ) : null}
                </span>
                <Badge variant={badge.variant}>{badge.label}</Badge>
              </>
            );
            return (
              <li key={item.key}>
                {item.href ? (
                  <a
                    href={item.href}
                    className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-inherit no-underline hover:bg-accent"
                  >
                    {row}
                  </a>
                ) : (
                  <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                    {row}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
