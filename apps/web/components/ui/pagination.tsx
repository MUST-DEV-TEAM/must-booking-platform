import { ChevronLeft, ChevronRight, ChevronsLeft } from 'lucide-react';

import { Button } from './button';

/** Page numbers to show: first, last, the current page and its neighbours; a gap only hides 2+ pages. */
export function visiblePages(page: number, pageCount: number): Array<number | 'gap'> {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1]);
  const numbers = [...wanted].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b);
  const result: Array<number | 'gap'> = [];
  numbers.forEach((n, index) => {
    const previous = numbers[index - 1];
    if (previous !== undefined && n - previous === 2) result.push(previous + 1);
    else if (previous !== undefined && n - previous > 2) result.push('gap');
    result.push(n);
  });
  return result;
}

/** "1-25 of 48" with page buttons. `page` is 1-based. Renders nothing useful for an empty list. */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages = visiblePages(page, pageCount);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          aria-label="First page"
          disabled={page <= 1}
          onClick={() => onPage(1)}
          className="hidden sm:inline-flex"
        >
          <ChevronsLeft />
        </Button>
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft />
        </Button>
        {pages.map((entry, index) =>
          entry === 'gap' ? (
            <span key={`gap-${index}`} className="px-1 text-muted-foreground">
              …
            </span>
          ) : (
            <Button
              key={entry}
              variant={entry === page ? 'default' : 'outline'}
              size="icon"
              aria-label={`Page ${entry}`}
              aria-current={entry === page ? 'page' : undefined}
              onClick={() => onPage(entry)}
              className="hidden sm:inline-flex"
            >
              {entry}
            </Button>
          ),
        )}
        <span className="px-2 text-sm font-semibold sm:hidden">
          {page} / {pageCount}
        </span>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
