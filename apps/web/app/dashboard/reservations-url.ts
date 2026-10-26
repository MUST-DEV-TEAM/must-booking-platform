/**
 * The Reservations list keeps its filters in the page address so a refresh, a shared link and the
 * browser's Back button all keep working. Parameters use an `r` prefix because the dashboard
 * already uses `payment`, `guest`, `tab` and `section` for other things.
 */

export type ReservationFilters = {
  view: string;
  status: string;
  payment: string;
  source: string;
  dateType: string;
  from: string | null;
  to: string | null;
  sort: string;
  direction: 'asc' | 'desc';
  page: number;
  pageSize: number;
};

export const DEFAULT_FILTERS: ReservationFilters = {
  view: 'all',
  status: 'all',
  payment: 'all',
  source: 'all',
  dateType: 'stay',
  from: null,
  to: null,
  sort: 'stay',
  direction: 'desc',
  page: 1,
  pageSize: 25,
};

const KEYS = [
  'rv',
  'rq',
  'rs',
  'rp',
  'rsrc',
  'rdt',
  'rfrom',
  'rto',
  'rsort',
  'rdir',
  'rpage',
  'rsize',
];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const word = /^[A-Za-z0-9_,-]{1,200}$/;

/** Writes only the values that differ from the defaults. */
export function filtersToParams(filters: ReservationFilters, search: string): URLSearchParams {
  const params = new URLSearchParams();
  const set = (key: string, value: string, fallback: string) => {
    if (value && value !== fallback) params.set(key, value);
  };
  set('rv', filters.view, DEFAULT_FILTERS.view);
  if (search.trim()) params.set('rq', search.trim());
  set('rs', filters.status, DEFAULT_FILTERS.status);
  set('rp', filters.payment, DEFAULT_FILTERS.payment);
  set('rsrc', filters.source, DEFAULT_FILTERS.source);
  if (filters.from) {
    set('rdt', filters.dateType, DEFAULT_FILTERS.dateType);
    params.set('rfrom', filters.from);
    params.set('rto', filters.to ?? filters.from);
  }
  set('rsort', filters.sort, DEFAULT_FILTERS.sort);
  set('rdir', filters.direction, DEFAULT_FILTERS.direction);
  if (filters.page > 1) params.set('rpage', String(filters.page));
  if (filters.pageSize !== DEFAULT_FILTERS.pageSize) params.set('rsize', String(filters.pageSize));
  return params;
}

/** Reads the filters back. Anything unrecognised or malformed falls back to the default. */
export function paramsToFilters(params: URLSearchParams): {
  filters: ReservationFilters;
  search: string;
} {
  const text = (key: string, fallback: string) => {
    const value = params.get(key);
    return value && word.test(value) ? value : fallback;
  };
  const date = (key: string) => {
    const value = params.get(key);
    return value && DATE.test(value) ? value : null;
  };
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const value = Number(params.get(key));
    return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
  };
  const from = date('rfrom');
  const to = date('rto');
  return {
    search: (params.get('rq') ?? '').slice(0, 100),
    filters: {
      view: text('rv', DEFAULT_FILTERS.view),
      status: text('rs', DEFAULT_FILTERS.status),
      payment: text('rp', DEFAULT_FILTERS.payment),
      source: text('rsrc', DEFAULT_FILTERS.source),
      dateType: text('rdt', DEFAULT_FILTERS.dateType),
      from: from && to && from <= to ? from : null,
      to: from && to && from <= to ? to : null,
      sort: text('rsort', DEFAULT_FILTERS.sort),
      direction: params.get('rdir') === 'asc' ? 'asc' : 'desc',
      page: integer('rpage', 1, 1, 10_000),
      pageSize: integer('rsize', DEFAULT_FILTERS.pageSize, 1, 100),
    },
  };
}

/** The page address with the filter parameters replaced and every other parameter kept. */
export function withFilterParams(
  currentSearch: string,
  filters: ReservationFilters,
  search: string,
): string {
  const params = new URLSearchParams(currentSearch);
  for (const key of KEYS) params.delete(key);
  filtersToParams(filters, search).forEach((value, key) => params.set(key, value));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** True when two addresses differ only by the search text (typing replaces history, not pushes). */
export function differsOnlyBySearch(a: string, b: string): boolean {
  const strip = (value: string) => {
    const params = new URLSearchParams(value);
    params.delete('rq');
    return params.toString();
  };
  return strip(a) === strip(b);
}
