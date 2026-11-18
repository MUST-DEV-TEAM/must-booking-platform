'use client';

import type { MouseEvent, ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { PageHeader } from './page-header';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select';

export type SettingsNavItem = { key: string; label: string; href: string };
export type SettingsNavGroup = {
  key: string;
  label: string;
  /** A short line under the group name, e.g. "Applies to all your hotels". */
  note?: string;
  items: readonly SettingsNavItem[];
};

/**
 * The Settings frame: a grouped side menu (a select on phones), the current page's title and
 * description, then the page. Plain links, so a new tab or a copied address works; a normal click
 * calls `onNavigate` to switch in place.
 */
export function SettingsLayout({
  title,
  description,
  groups,
  current,
  pageTitle,
  pageDescription,
  onNavigate,
  children,
}: {
  title: string;
  description?: string;
  groups: readonly SettingsNavGroup[];
  current: string;
  pageTitle: string;
  pageDescription?: string;
  onNavigate?: (key: string) => void;
  children: ReactNode;
}) {
  const items = groups.flatMap((group) => group.items);
  const follow = (event: MouseEvent<HTMLAnchorElement>, key: string) => {
    if (
      !onNavigate ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    onNavigate(key);
  };
  const choose = (key: string) => {
    if (onNavigate) onNavigate(key);
    else {
      const href = items.find((item) => item.key === key)?.href;
      if (href) window.location.assign(href);
    }
  };
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={title} description={description} />
      <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label={`${title} menu`} className="hidden lg:block">
          <div className="sticky top-4 flex flex-col gap-5">
            {groups.map((group) => (
              <div key={group.key} className="flex flex-col gap-1">
                <p className="m-0 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </p>
                {group.note ? (
                  <p className="m-0 px-3 text-xs text-muted-foreground">{group.note}</p>
                ) : null}
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                  {group.items.map((item) => {
                    const active = item.key === current;
                    return (
                      <li key={item.key}>
                        <a
                          href={item.href}
                          aria-current={active ? 'page' : undefined}
                          onClick={(event) => follow(event, item.key)}
                          className={cn(
                            'block rounded-md px-3 py-1.5 text-sm no-underline transition-colors',
                            active
                              ? 'bg-muted font-semibold text-foreground'
                              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                          )}
                        >
                          {item.label}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </nav>
        <div className="flex min-w-0 flex-col gap-5">
          <div className="lg:hidden">
            <Select value={current} onValueChange={choose}>
              <SelectTrigger aria-label={`${title} page`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {groups.map((group) => (
                  <SelectGroup key={group.key}>
                    {group.items.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {group.label} · {item.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <h3 className="m-0 text-xl font-bold tracking-tight">{pageTitle}</h3>
            {pageDescription ? (
              <p className="m-0 text-sm text-muted-foreground">{pageDescription}</p>
            ) : null}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
