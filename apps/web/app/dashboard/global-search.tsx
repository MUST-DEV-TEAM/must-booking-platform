'use client';

import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';

import { SearchInput } from '../../components/ui/search-input';

type Item = {
  type: 'booking' | 'guest' | 'room' | 'room_type';
  id: string;
  title: string;
  subtitle: string;
};
type Group = { key: string; label: string; items: Item[] };
type Result = { query: string; groups: Group[] };

export function searchItemHref(tenantId: string, propertyId: string, item: Item): string {
  const base = `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}`;
  if (item.type === 'booking') return `${base}&section=reservations&reservation=${item.id}`;
  if (item.type === 'guest') return `${base}&section=guests&guest=${item.id}`;
  return `${base}&section=accommodations`;
}

/** Header search across reservations, guests and rooms. Results only include what the person may see. */
export function GlobalSearch({ tenantId, propertyId }: { tenantId: string; propertyId: string }) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  // "/" focuses the search unless the user is already typing somewhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, []);

  const enabled = debounced.length >= 2;
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

  const items = (query.data?.groups ?? []).flatMap((group) => group.items);
  const hrefs = items.map((item) => searchItemHref(tenantId, propertyId, item));
  const showPanel = open && text.trim().length >= 2;

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      input.current?.blur();
    } else if (event.key === 'ArrowDown' && items.length) {
      event.preventDefault();
      setActive((value) => (value + 1) % items.length);
    } else if (event.key === 'ArrowUp' && items.length) {
      event.preventDefault();
      setActive((value) => (value - 1 + items.length) % items.length);
    } else if (event.key === 'Enter' && items.length && hrefs[active]) {
      event.preventDefault();
      window.location.href = hrefs[active]!;
    }
  };

  let index = -1;
  return (
    <div ref={root} className="relative w-full min-w-40 sm:w-56 lg:w-72">
      <SearchInput
        ref={input}
        aria-label="Search reservations, guests and rooms"
        placeholder="Search…  ( / )"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        autoComplete="off"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {showPanel ? (
        <div
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute top-full right-0 left-0 z-50 mt-1 max-h-96 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md sm:min-w-80"
        >
          {!enabled || query.isFetching ? (
            <p className="m-0 px-3 py-2 text-sm text-muted-foreground">Searching…</p>
          ) : query.isError ? (
            <p role="alert" className="m-0 px-3 py-2 text-sm text-destructive">
              Search is unavailable. Try again.
            </p>
          ) : items.length === 0 ? (
            <p className="m-0 px-3 py-2 text-sm text-muted-foreground">
              No results for “{debounced}”.
            </p>
          ) : (
            query.data!.groups.map((group) => (
              <div key={group.key} role="group" aria-label={group.label}>
                <p className="m-0 px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {group.label}
                </p>
                {group.items.map((item) => {
                  index += 1;
                  const current = index;
                  return (
                    <a
                      key={`${item.type}-${item.id}`}
                      role="option"
                      aria-selected={current === active}
                      href={hrefs[current]}
                      onMouseEnter={() => setActive(current)}
                      className={
                        'flex flex-col rounded-sm px-3 py-2 text-inherit no-underline ' +
                        (current === active ? 'bg-accent' : '')
                      }
                    >
                      <span className="text-sm font-semibold">{item.title}</span>
                      <span className="text-xs text-muted-foreground">{item.subtitle}</span>
                    </a>
                  );
                })}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
