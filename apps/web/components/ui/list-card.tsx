import { ChevronRight } from 'lucide-react';
import { Children, type ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { Badge } from './badge';
import { Button } from './button';
import { Card, CardContent, CardHeader, CardTitle } from './card';

/**
 * A titled card that holds a short list of rows, such as today's arrivals. Shows the empty
 * message when there are no rows and an optional "view all" link in the corner.
 */
export function ListCard({
  title,
  count,
  description,
  action,
  empty,
  children,
}: {
  title: string;
  count?: number;
  description?: string;
  action?: { label: string; href: string };
  /** Shown instead of the rows when the list is empty. */
  empty?: string;
  children?: ReactNode;
}) {
  return (
    <Card className="gap-4">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            {title}
            {count !== undefined ? (
              <Badge variant="secondary" className="rounded-full px-2 py-0 text-[11px]">
                {count}
              </Badge>
            ) : null}
          </CardTitle>
          {action ? (
            <Button variant="link" size="sm" asChild className="h-auto p-0 text-xs">
              <a href={action.href}>{action.label}</a>
            </Button>
          ) : null}
        </div>
        {description ? <p className="m-0 text-xs text-muted-foreground">{description}</p> : null}
      </CardHeader>
      <CardContent>
        {empty !== undefined && Children.toArray(children).length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y p-0">{children}</ul>
        )}
      </CardContent>
    </Card>
  );
}

/** One row of a ListCard: a title and a line under it, something on the right, optionally a link. */
export function ListRow({
  title,
  subtitle,
  trailing,
  href,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-sm leading-5 font-semibold">{title}</p>
        {subtitle ? <p className="m-0 truncate text-xs leading-4 text-muted-foreground">{subtitle}</p> : null}
      </div>
      {trailing ? <div className="shrink-0 text-xs text-muted-foreground">{trailing}</div> : null}
      {href ? <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /> : null}
    </>
  );
  const row = 'flex items-center gap-3 py-2.5';
  return (
    <li>
      {href ? (
        <a
          href={href}
          className={cn(row, '-mx-2 rounded-md px-2 text-inherit no-underline outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50')}
        >
          {body}
        </a>
      ) : (
        <div className={row}>{body}</div>
      )}
    </li>
  );
}
