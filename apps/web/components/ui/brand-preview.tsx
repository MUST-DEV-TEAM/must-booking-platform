'use client';

import { Globe } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';
import { FormSection } from './form-section';

const colourOr = (value: string | undefined, fallback: string) =>
  /^#[0-9a-f]{6}$/i.test(value ?? '') ? (value as string) : fallback;

function Frame({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      <div className={cn('overflow-hidden rounded-md border bg-card', className)}>{children}</div>
    </div>
  );
}

/**
 * What the brand settings look like where guests and staff meet them: the email header and footer, the
 * booking page header, the browser tab and the hotel switcher. It updates as the fields change; nothing is
 * sent or saved.
 */
export function BrandPreview({
  name,
  logoUrl,
  logoDarkUrl,
  iconUrl,
  faviconUrl,
  coverUrl,
  colour,
  accent,
  footerLines,
  note,
  termsUrl,
}: {
  name: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  iconUrl: string | null;
  faviconUrl: string | null;
  coverUrl: string | null;
  colour?: string;
  accent?: string;
  /** The lines the email footer is built from, in order. */
  footerLines: readonly string[];
  note?: string;
  termsUrl?: string;
}) {
  const brand = colourOr(colour, '#141414');
  const link = colourOr(accent, brand);
  const tab = faviconUrl ?? iconUrl;
  return (
    <FormSection title="Live preview" description="Updates as you type. Nothing is sent.">
      <Frame title="Email header and footer">
        <div className="flex items-center gap-3 border-b bg-white px-4 py-3">
          {logoUrl ? (
            <img src={logoUrl} alt="" className="max-h-10 max-w-36 object-contain" />
          ) : (
            <span className="text-sm font-semibold text-neutral-900">{name}</span>
          )}
        </div>
        <div className="flex flex-col gap-2 bg-white px-4 py-3 text-neutral-900">
          <p className="m-0 text-sm">Your booking is confirmed.</p>
          <span
            className="w-fit rounded px-3 py-1.5 text-xs font-semibold text-white"
            style={{ backgroundColor: brand }}
          >
            View booking
          </span>
          <span className="text-xs underline" style={{ color: link }}>
            Manage your booking
          </span>
        </div>
        <div className="flex flex-col gap-0.5 border-t bg-neutral-50 px-4 py-3 text-[11px] leading-snug text-neutral-600">
          {footerLines.map((line) => (
            <span key={line}>{line}</span>
          ))}
          {note ? <span className="mt-1">{note}</span> : null}
          {termsUrl?.startsWith('https://') ? (
            <span className="underline" style={{ color: link }}>
              Terms and conditions
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3 px-4 py-3" style={{ background: '#1f2933' }}>
          {logoDarkUrl ? (
            <img src={logoDarkUrl} alt="" className="max-h-8 max-w-32 object-contain" />
          ) : logoUrl ? (
            <span className="rounded bg-white px-2 py-1">
              <img src={logoUrl} alt="" className="max-h-6 max-w-28 object-contain" />
            </span>
          ) : (
            <span className="text-xs font-semibold text-white">{name}</span>
          )}
          <span className="text-[11px] text-neutral-300">On a dark header</span>
        </div>
      </Frame>
      <Frame title="Booking page header">
        <div
          className="relative flex h-28 items-end bg-neutral-200 p-3"
          style={
            coverUrl
              ? {
                  backgroundImage: `url(${coverUrl})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }
              : undefined
          }
        >
          <span className="flex items-center gap-2 rounded bg-white/95 px-2.5 py-1.5 text-neutral-900 shadow-sm">
            {logoUrl ? (
              <img src={logoUrl} alt="" className="max-h-6 max-w-28 object-contain" />
            ) : null}
            <span className="text-xs font-semibold">{name}</span>
          </span>
        </div>
      </Frame>
      <div className="grid gap-3 sm:grid-cols-2">
        <Frame title="Browser tab">
          <div className="flex items-center gap-2 bg-neutral-100 px-3 py-2">
            <span className="flex max-w-full items-center gap-2 rounded-t-md bg-white px-3 py-1.5 text-xs">
              {tab ? (
                <img src={tab} alt="" className="size-4 shrink-0 rounded-sm object-cover" />
              ) : (
                <Globe aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{name}</span>
            </span>
          </div>
        </Frame>
        <Frame title="Hotel switcher">
          <div className="flex items-center gap-2 px-3 py-2.5 text-xs">
            {iconUrl ? (
              <img src={iconUrl} alt="" className="size-7 shrink-0 rounded-md object-cover" />
            ) : (
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold">
                {name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <span className="truncate font-semibold">{name}</span>
          </div>
        </Frame>
      </div>
    </FormSection>
  );
}
