'use client';

import { useQuery } from '@tanstack/react-query';
import { UserCheck, UserRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/button';
import { SearchInput } from '../../components/ui/search-input';

export type KnownGuest = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  streetAddress?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  county?: string | null;
  postcode?: string | null;
  countryCode?: string | null;
  bookingCount: number;
  source?: 'CLOCK';
  mostRecentStartsOn?: string;
};

const nameOf = (guest: KnownGuest) =>
  [guest.firstName, guest.lastName].filter(Boolean).join(' ') || guest.email;

/**
 * Finds a guest who has stayed before, by name, email or phone, so their details do not have to be
 * typed again. Choosing one hands the guest to `onPick`; the reservation still saves its own copy.
 * Hidden by itself for people who cannot open the guest list.
 */
export function GuestLookup({
  tenantId,
  propertyId,
  selected,
  onPick,
  onClear,
}: {
  tenantId: string;
  propertyId: string;
  selected: KnownGuest | null;
  onPick: (guest: KnownGuest) => void;
  onClear: () => void;
}) {
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(text.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [text]);

  const results = useQuery({
    queryKey: ['dashboard', 'guest-lookup', tenantId, propertyId, term],
    queryFn: async (): Promise<KnownGuest[] | null> => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/guests?search=${encodeURIComponent(term)}`,
        { credentials: 'include' },
      );
      if (response.status === 403) return null;
      if (!response.ok) return [];
      const local = (await response.json()) as KnownGuest[];
      const clock = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/clock-guests?search=${encodeURIComponent(term)}`,
        { credentials: 'include' },
      ).catch(() => null);
      if (!clock?.ok) return local;
      const profiles = (await clock.json()) as Array<
        Omit<KnownGuest, 'email' | 'bookingCount'> & { email: string | null }
      >;
      if (!Array.isArray(profiles)) return local;
      return [
        ...local,
        ...profiles
          .filter(
            (g) => !g.email || !local.some((l) => l.email.toLowerCase() === g.email!.toLowerCase()),
          )
          .map((g) => ({ ...g, email: g.email ?? '', bookingCount: 0, source: 'CLOCK' as const })),
      ];
    },
    enabled: term.length >= 2 && !selected,
    staleTime: 30_000,
  });

  if (results.data === null) return null;

  if (selected)
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-success/30 bg-success-surface px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <UserCheck aria-hidden="true" className="size-5 shrink-0 text-success" />
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-bold">{nameOf(selected)}</p>
            <p className="m-0 text-xs text-muted-foreground">
              {selected.source === 'CLOCK' ? (
                'Clock profile. Confirm the contact details below with the guest.'
              ) : (
                <>
                  Existing guest; {selected.bookingCount} previous stay
                  {selected.bookingCount === 1 ? '' : 's'}. Details are filled in below for this
                  reservation.
                </>
              )}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClear}>
          <X aria-hidden="true" /> Use a different guest
        </Button>
      </div>
    );

  return (
    <div className="space-y-2">
      <SearchInput
        aria-label="Find an existing guest"
        placeholder="Find a guest who stayed before: name, email or phone"
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {term.length >= 2 && results.data ? (
        results.data.length === 0 ? (
          <p className="m-0 text-xs text-muted-foreground">
            No guest found. Fill in the details below to add a new guest.
          </p>
        ) : (
          <ul className="m-0 max-h-56 list-none divide-y overflow-y-auto rounded-lg border p-0">
            {results.data.slice(0, 8).map((guest) => (
              <li key={guest.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(guest);
                    setText('');
                  }}
                  className="flex w-full items-center gap-3 bg-transparent px-3 py-2 text-left outline-none hover:bg-muted/60 focus-visible:bg-muted/60"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                    <UserRound aria-hidden="true" className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{nameOf(guest)}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {guest.email}
                      {guest.phone ? ` · ${guest.phone}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {guest.source === 'CLOCK'
                      ? 'Clock profile'
                      : `${guest.bookingCount} stay${guest.bookingCount === 1 ? '' : 's'}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}
