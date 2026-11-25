'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState, type ReactNode } from 'react';

import { Button } from './button';

const LocationPinMap = dynamic(() => import('./location-pin-map'), {
  ssr: false,
  loading: () => <div className="h-72 w-full animate-pulse rounded-md border bg-muted" />,
});

const sixDecimals = (value: number) => String(Math.round(value * 1e6) / 1e6);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The searches to try, most precise first: the address with repeated parts removed, then without the
 * street, then without the next part. At most three.
 */
export function addressSearches(address: string): string[] {
  const parts: string[] = [];
  for (const part of address
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean))
    if (!parts.some((seen) => seen.toLowerCase() === part.toLowerCase())) parts.push(part);
  const searches: string[] = [];
  for (let start = 0; start < parts.length - 1 && searches.length < 3; start += 1)
    searches.push(parts.slice(start).join(', '));
  return searches.length ? searches : parts.slice(0, 1);
}

/** OpenStreetMap's free address search (Nominatim): at most one request a second, as its usage policy asks. */
async function findAddress(query: string): Promise<[number, number] | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', query);
  const response = await fetch(url, { headers: { 'Accept-Language': 'en' } });
  if (!response.ok) throw new Error('search failed');
  const [first] = (await response.json()) as Array<{ lat: string; lon: string }>;
  return first ? [Number(first.lat), Number(first.lon)] : null;
}

/**
 * A map pin for a place: "Find from address" looks the address up, then the pin can be dragged to the
 * exact entrance (or placed with a click). Values are latitude and longitude text with up to 6 decimals.
 */
export function LocationPin({
  latitude,
  longitude,
  address,
  disabled,
  label,
  children,
  onChange,
}: {
  /** A name shown above the pin, for example the hotel name. */
  label?: string;
  /** Shown in the right column under the button, for example the latitude and longitude fields. */
  children?: ReactNode;
  latitude: string;
  longitude: string;
  /** The address to look up, for example "Rruga e Plazhit, Durrës, Albania". */
  address: string;
  disabled?: boolean;
  onChange: (latitude: string, longitude: string) => void;
}) {
  // The map needs a real browser; test environments get the button and the coordinates only.
  const [canDraw, setCanDraw] = useState(false);
  useEffect(() => setCanDraw(typeof ResizeObserver !== 'undefined'), []);
  const [status, setStatus] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const lat = Number(latitude),
    lng = Number(longitude);
  const position: [number, number] | null =
    latitude !== '' && longitude !== '' && Number.isFinite(lat) && Number.isFinite(lng)
      ? [lat, lng]
      : null;
  const place = (a: number, b: number) => onChange(sixDecimals(a), sixDecimals(b));

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="md:col-span-2">
        {canDraw ? (
          <LocationPinMap position={position} disabled={disabled} label={label} onChange={place} />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={disabled || searching || !address.trim()}
          onClick={async () => {
            setSearching(true);
            setStatus(null);
            try {
              const searches = addressSearches(address);
              let found: [number, number] | null = null;
              let exact = true;
              for (const [index, search] of searches.entries()) {
                if (index > 0) await wait(1100);
                found = await findAddress(search);
                if (found) break;
                exact = false;
              }
              if (found) place(found[0], found[1]);
              setStatus(
                !found
                  ? 'That address was not found. Place the pin on the map instead.'
                  : exact
                    ? 'Pin placed from the address. Drag it to the entrance if needed.'
                    : 'The street was not found, so the pin is in the town. Drag it to the hotel.',
              );
            } catch {
              setStatus('The address search is not available right now. Place the pin on the map.');
            } finally {
              setSearching(false);
            }
          }}
        >
          {searching ? 'Finding…' : 'Find from address'}
        </Button>
        {status ? (
          <p role="status" className="m-0 text-xs text-muted-foreground">
            {status}
          </p>
        ) : !position ? (
          <p className="m-0 text-xs text-muted-foreground">
            No pin yet. Find it from the address or click the map.
          </p>
        ) : null}
        {children}
        {position && !disabled ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => onChange('', '')}
          >
            Remove pin
          </Button>
        ) : null}
      </div>
    </div>
  );
}
