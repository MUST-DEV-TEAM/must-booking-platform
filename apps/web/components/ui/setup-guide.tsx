import type { ReactNode } from 'react';

import { Button } from './button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { Progress } from './progress';

export type SetupGuideStep = {
  key: string;
  label: string;
  detail?: ReactNode;
  done: boolean;
  /** Where the button goes. */
  href: string;
  /** The button's words for a step that is not done, for example "Set up" or "Fix". */
  action: string;
};

/**
 * A setup guide: title, progress bar, and one row per step. A finished step shows a green tick; an
 * unfinished one shows its number in red and a button to the place that finishes it.
 */
export function SetupGuide({
  title,
  description,
  steps,
  headerAction,
}: {
  title: string;
  description?: ReactNode;
  steps: readonly SetupGuideStep[];
  /** Shown at the top right, for example "Hide for now". */
  headerAction?: ReactNode;
}) {
  const done = steps.filter((step) => step.done).length;
  const percent = steps.length ? Math.round((done / steps.length) * 100) : 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        {headerAction ? (
          <div className="col-start-2 row-span-2 row-start-1 justify-self-end">{headerAction}</div>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Progress
          value={percent}
          aria-label={`${done} of ${steps.length} steps done`}
          className="h-2"
        />
        <ol className="m-0 flex list-none flex-col p-0">
          {steps.map((step, index) => (
            <li
              key={step.key}
              className="flex items-center gap-3 border-b py-3 last:border-b-0 last:pb-0"
            >
              <span
                role="img"
                aria-label={step.done ? 'Done' : `Step ${index + 1}, not done`}
                className={`flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  step.done
                    ? 'bg-success-surface text-success'
                    : 'bg-destructive-surface text-destructive'
                }`}
              >
                {step.done ? '✓' : index + 1}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-semibold">{step.label}</span>
                {step.detail ? (
                  <span className="text-xs text-muted-foreground">{step.detail}</span>
                ) : null}
              </span>
              {step.done ? null : (
                <Button asChild size="sm" variant="outline">
                  <a href={step.href}>{step.action}</a>
                </Button>
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
