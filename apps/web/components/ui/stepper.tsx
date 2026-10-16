import { Check } from 'lucide-react';

import { cn } from '../../lib/utils';

export type StepperStep = { id: string; title: string; description?: string };

/**
 * Progress through a multi-step flow: numbered cards where finished steps show a tick, the
 * current step is outlined and later steps are muted. Read-only; the flow's own buttons move
 * between steps.
 */
export function Stepper({
  steps,
  current,
  label = 'Progress',
}: {
  steps: readonly StepperStep[];
  /** Index of the current step, 0-based. */
  current: number;
  label?: string;
}) {
  return (
    <div>
      <ol
        aria-label={label}
        className="m-0 grid list-none gap-3 p-0"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
      {steps.map((step, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={step.id}
            aria-current={active ? 'step' : undefined}
            className={cn(
              'flex items-start gap-3 rounded-xl border p-3',
              active ? 'border-primary bg-card shadow-xs' : 'bg-card/60 text-muted-foreground',
            )}
          >
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                active || done ? 'bg-primary text-primary-foreground' : 'bg-muted',
              )}
            >
              {done ? <Check aria-hidden="true" className="size-4" /> : index + 1}
            </span>
            <div className="min-w-0">
              <p className={cn('m-0 text-sm font-semibold', active && 'text-foreground')}>{step.title}</p>
              {step.description ? (
                <p className="m-0 hidden text-xs sm:block">{step.description}</p>
              ) : null}
            </div>
          </li>
        );
      })}
      </ol>
    </div>
  );
}
