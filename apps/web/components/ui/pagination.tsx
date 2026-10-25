import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

import { Button } from './button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

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

/**
 * Table footer: "Showing 1-25 of 48 reservations", an optional rows-per-page choice and page
 * buttons. `page` is 1-based. Meant to sit at the bottom of a card (it draws its own top border).
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  noun = 'items',
  pageSizeOptions,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  noun?: string;
  pageSizeOptions?: readonly number[];
  onPageSize?: (size: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const pages = visiblePages(page, pageCount);
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-[11px] text-muted-foreground"
    >
      <span>
        Showing {from}–{to} of {total} {noun}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {pageSizeOptions && onPageSize ? (
          <>
            <label htmlFor="rows-per-page">Rows per page</label>
            <Select value={String(pageSize)} onValueChange={(value) => onPageSize(Number(value))}>
              <SelectTrigger
                id="rows-per-page"
                aria-label="Rows per page"
                className="h-8 w-[68px] text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : null}
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="First page"
          disabled={page <= 1}
          onClick={() => onPage(1)}
        >
          <ChevronsLeft aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        {pages.map((entry, index) =>
          entry === 'gap' ? (
            <span key={`gap-${index}`} className="px-1">
              …
            </span>
          ) : (
            <Button
              key={entry}
              variant={entry === page ? 'default' : 'outline'}
              size="icon-sm"
              aria-label={`Page ${entry}`}
              aria-current={entry === page ? 'page' : undefined}
              onClick={() => onPage(entry)}
              className="hidden sm:inline-flex"
            >
              {entry}
            </Button>
          ),
        )}
        <span className="px-1 font-semibold sm:hidden">
          {page} / {pageCount}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next page"
          disabled={page >= pageCount}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight aria-hidden="true" />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Last page"
          disabled={page >= pageCount}
          onClick={() => onPage(pageCount)}
        >
          <ChevronsRight aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
