import type { ReactNode } from 'react';

import { Badge } from './badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';

/** A titled card that groups related form fields, with an optional one-sentence explanation. */
export function FormSection({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** A short note beside the title, such as who decides this setting. */
  badge?: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-lg">{title}</CardTitle>
          {badge ? <Badge variant="muted">{badge}</Badge> : null}
        </div>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}
