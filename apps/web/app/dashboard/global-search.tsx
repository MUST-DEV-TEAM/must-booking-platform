'use client';

import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';

import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { SearchInput } from '../../components/ui/search-input';
import { matchPages, quickLinks, type SearchPage } from './search-pages';

type Item = {
  type: 'booking' | 'guest' | 'room' | 'room_type' | 'staff' | 'email' | 'payment' | 'rate_plan';
  id: string;
  target?: string;
  title: string;
  subtitle: string;
};
type Group = { key: string; label: string; items: Item[] };
type Result = { query: string; groups: Group[] };
type Row = { key: string; group: string; title: string; subtitle: string; href: string };

const EXAMPLES = [
  'A booking reference, like MLDH-261016-1747',
  'A guest name, email or phone number',
  'A page, like payments, calendar or reports',
  'A setting, like check-in time or email templates',
  'A room, like Room 204',
  'A staff member, like Ana',
  'An email you sent, like “booking confirmed”',
];
// Recent searches are kept per person, so a shared computer never shows one person's searches to another.
const recentKey = (userId: string | undefined) => `must.search.recent.${userId ?? 'anonymous'}`;

/** Splits text around the typed words so matches can be shown in bold. */
export function highlightParts(
  text: string,
  query: string,
): Array<{ text: string; match: boolean }> {
  const words = query
    .trim()
    .split(/\s+/)
    .filter((word) => word.length >= 2)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return [{ text, match: false }];
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'gi'));
  return parts
    .filter((part) => part !== '')
    .map((part) => ({
      text: part,
      match: words.some((w) => new RegExp(`^${w}$`, 'i').test(part)),
    }));
}

function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, index) =>
        part.match ? (
          <mark key={index} className="rounded-xs bg-primary/15 px-0.5 text-inherit">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

export function searchItemHref(tenantId: string, propertyId: string, item: Item): string {
  const base = `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}`;
  if (item.type === 'booking') return `${base}&section=reservations&reservation=${item.id}`;
  if (item.type === 'guest') return `${base}&section=guests&guest=${item.id}`;
  if (item.type === 'staff') return `${base}&section=staff&staffUser=${item.id}`;
  if (item.type === 'email') return `${base}&section=emails&emailMessageId=${item.id}`;
  if (item.type === 'payment') return `${base}&section=payments&payment=${item.target ?? item.id}`;
  if (item.type === 'rate_plan') return `${base}&section=rates-pricing`;
  // A room opens its room type (rooms live inside it); a room type opens itself.
  return `${base}&section=accommodations&roomType=${item.type === 'room' ? (item.target ?? '') : item.id}`;
}

const pageHref = (tenantId: string, propertyId: string, page: SearchPage) =>
  `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=${page.section}${page.extra ? `&${page.extra}` : ''}`;

function readRecent(userId: string | undefined): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(recentKey(userId)) ?? '[]') as unknown;
    return Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string').slice(0, 5)
      : [];
  } catch {
    return [];
  }
}
function rememberSearch(userId: string | undefined, text: string) {
  try {
    const next = [text, ...readRecent(userId).filter((v) => v !== text)].slice(0, 5);
    window.localStorage.setItem(recentKey(userId), JSON.stringify(next));
  } catch {
    // Recent searches are a convenience only.
  }
}

/**
 * The header search: an icon that opens a popup over the page. It finds reservations, guests (names,
 * emails, phone numbers), rooms, staff, sent emails, pages and settings, each only if the person may see it.
 */
export function GlobalSearch({
  tenantId,
  propertyId,
  canOpen,
  can,
  userId,
}: {
  tenantId: string;
  propertyId: string;
  /** Whose recent searches to keep. */
  userId?: string;
  /** Whether the person may open a dashboard section. */
  canOpen: (section: string) => boolean;
  /** Whether the person holds a capability. */
  can: (capability: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const [example, setExample] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const listId = useId();

  // "/" and Ctrl/Cmd+K open the search from anywhere unless the person is typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (
        (event.key === 'k' && (event.ctrlKey || event.metaKey)) ||
        (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey)
      ) {
        event.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setRecent(readRecent(userId));
    const timer = setInterval(() => setExample((value) => (value + 1) % EXAMPLES.length), 2800);
    return () => clearInterval(timer);
  }, [open, userId]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const enabled = open && debounced.length >= 2;
  const query = useQuery({
    queryKey: ['dashboard', 'search', tenantId, propertyId, debounced],
    queryFn: async (): Promise<Result> => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/search?q=${encodeURIComponent(debounced)}`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error('Search is unavailable.');
      return (await response.json()) as Result;
    },
    enabled,
    staleTime: 15_000,
    retry: false,
  });

  const typed = text.trim();
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (typed.length < 2) {
      for (const page of quickLinks(canOpen, can))
        out.push({
          key: `q-${page.label}`,
          group: 'Quick links',
          title: page.label,
          subtitle: page.hint,
          href: pageHref(tenantId, propertyId, page),
        });
      return out;
    }
    for (const page of matchPages(typed, canOpen, can))
      out.push({
        key: `p-${page.label}`,
        group: 'Pages and settings',
        title: page.label,
        subtitle: `${page.kind} · ${page.hint}`,
        href: pageHref(tenantId, propertyId, page),
      });
    if (debounced === typed)
      for (const group of query.data?.groups ?? [])
        for (const item of group.items)
          out.push({
            key: `${item.type}-${item.id}`,
            group: group.label,
            title: item.title,
            subtitle: item.subtitle,
            href: searchItemHref(tenantId, propertyId, item),
          });
    return out;
  }, [typed, debounced, query.data, canOpen, can, tenantId, propertyId]);

  const waiting = typed.length >= 2 && (debounced !== typed || query.isFetching);
  const go = (row: Row) => {
    if (typed.length >= 2) rememberSearch(userId, typed);
    window.location.href = row.href;
  };
  const close = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setText('');
      setDebounced('');
      setActive(0);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' && rows.length) {
      event.preventDefault();
      setActive((value) => (value + 1) % rows.length);
    } else if (event.key === 'ArrowUp' && rows.length) {
      event.preventDefault();
      setActive((value) => (value - 1 + rows.length) % rows.length);
    } else if (event.key === 'Enter' && rows[active]) {
      event.preventDefault();
      go(rows[active]!);
    }
  };

  let lastGroup = '';
  return (
    <>
      <Button
        variant="outline"
        size="icon"
        className="size-10"
        aria-label="Search"
        title="Search ( / )"
        onClick={() => setOpen(true)}
      >
        <Search aria-hidden="true" />
      </Button>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="top-[14%] max-h-[75dvh] w-[calc(100%-2rem)] translate-y-0 gap-3 overflow-hidden rounded-xl p-4 sm:max-w-[740px]">
          <DialogTitle className="pr-8">Search this hotel</DialogTitle>
          <DialogDescription className="sr-only">
            Search reservations, guests, rooms, staff, emails, pages and settings.
          </DialogDescription>
          <div className="pr-8">
            <SearchInput
              autoFocus
              aria-label="Search"
              placeholder={EXAMPLES[example]}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              autoComplete="off"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
          </div>
          <p className="m-0 text-xs text-muted-foreground">
            Find reservations, guests (by name, email or phone), rooms, staff, sent emails, pages
            and settings.
            <span className="hidden sm:inline"> ↑ ↓ to move · Enter to open · Esc to close</span>
          </p>
          <div
            id={listId}
            role="listbox"
            aria-label="Search results"
            className="-mx-1 max-h-[50vh] overflow-y-auto px-1"
          >
            {typed.length < 2 && recent.length > 0 ? (
              <div role="group" aria-label="Recent searches" className="pb-2">
                <p className="m-0 px-2 pt-1 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Recent searches
                </p>
                <div className="flex flex-wrap gap-2 px-2">
                  {recent.map((value) => (
                    <button
                      key={value}
                      type="button"
                      className="rounded-full border bg-transparent px-3 py-1 text-sm"
                      onClick={() => {
                        setText(value);
                        setDebounced(value);
                      }}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {rows.map((row, index) => {
              const heading = row.group !== lastGroup ? row.group : null;
              lastGroup = row.group;
              return (
                <div key={row.key} role="presentation">
                  {heading ? (
                    <p className="m-0 px-2 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      {heading}
                    </p>
                  ) : null}
                  <a
                    role="option"
                    aria-selected={index === active}
                    href={row.href}
                    onClick={() => {
                      if (typed.length >= 2) rememberSearch(userId, typed);
                    }}
                    onMouseEnter={() => setActive(index)}
                    className={
                      'flex flex-col rounded-md px-2 py-2 text-inherit no-underline ' +
                      (index === active ? 'bg-accent' : '')
                    }
                  >
                    <span className="text-sm font-semibold">
                      <Highlight text={row.title} query={typed} />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      <Highlight text={row.subtitle} query={typed} />
                    </span>
                  </a>
                </div>
              );
            })}
            {typed.length >= 2 && waiting ? (
              <p className="m-0 px-2 py-2 text-sm text-muted-foreground">Searching…</p>
            ) : null}
            {typed.length >= 2 && !waiting && query.isError ? (
              <p role="alert" className="m-0 px-2 py-2 text-sm text-destructive">
                Search for records is unavailable. Pages and settings are still listed above.
              </p>
            ) : null}
            {typed.length >= 2 && !waiting && !query.isError && rows.length === 0 ? (
              <p className="m-0 px-2 py-2 text-sm text-muted-foreground">
                No results for “{typed}”. Try a booking reference, a guest name or a page name.
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
