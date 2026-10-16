import { ChevronRight } from 'lucide-react';

import { cn } from '../../lib/utils';

export type BreadcrumbItem = { label: string; href?: string };

/**
 * Where you are: the last item is the current page; earlier items link up. On phones only the
 * current page and its parent show.
 */
export function Breadcrumb({ items }: { items: readonly BreadcrumbItem[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="m-0 flex list-none flex-wrap items-center gap-x-1.5 gap-y-1 p-0 text-sm text-muted-foreground">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          const hiddenOnPhone = index < items.length - 2;
          return (
            <li
              key={`${item.label}-${index}`}
              className={cn('max-w-full min-w-0 items-center gap-1.5 break-words', hiddenOnPhone ? 'hidden sm:flex' : 'flex')}
            >
              {index > 0 ? <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" /> : null}
              {last || !item.href ? (
                <span aria-current={last ? 'page' : undefined} className={cn(last && 'font-semibold text-foreground')}>
                  {item.label}
                </span>
              ) : (
                <a href={item.href} className="text-inherit no-underline hover:text-foreground hover:underline">
                  {item.label}
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
