import type { ReactNode } from 'react';

export type TimelineItem = {
  key: string;
  title: string;
  /** Who and when, shown small under the title. */
  meta?: string;
  detail?: ReactNode;
};

/** A vertical list of what happened and when, newest first as given. */
export function Timeline({
  items,
  empty = 'Nothing has happened yet.',
}: {
  items: readonly TimelineItem[];
  empty?: string;
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ol className="list-none space-y-4">
      {items.map((item, index) => (
        <li key={item.key} className="relative pl-5">
          <span
            aria-hidden="true"
            className="absolute top-1.5 left-0 size-2 rounded-full bg-primary"
          />
          {index < items.length - 1 ? (
            <span
              aria-hidden="true"
              className="absolute top-4 bottom-[-1rem] left-[3px] w-px bg-border"
            />
          ) : null}
          <p className="text-sm font-semibold">{item.title}</p>
          {item.meta ? <p className="text-xs text-muted-foreground">{item.meta}</p> : null}
          {item.detail ? (
            <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
