'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePmsSource } from './use-pms-source';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import {
  Table,
  TableBody,
  TableRow,
  TableCell,
  TableHeader,
  TableHead,
} from '../../components/ui/table';
type Guest = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  syncedAt: string;
};
type Progress = { updatedFrom: string; updatedUntil: string; cursor: string; processed: number };
export function ClockGuestDirectory({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const source = usePmsSource(tenantId, propertyId),
    client = useQueryClient();
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(''),
    [term, setTerm] = useState('');
  const [from, setFrom] = useState('1970-01-01'),
    [until, setUntil] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [progress, setProgress] = useState<Progress | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const pause = useRef(false);
  const storageKey = `clock-guests:${tenantId}:${propertyId}`;
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setProgress(null);
    try {
      const p = JSON.parse(localStorage.getItem(storageKey) || 'null') as Progress | null;
      if (p) {
        setProgress(p);
        setFrom(p.updatedFrom);
        setUntil(p.updatedUntil);
      }
    } catch {}
    return () => {
      pause.current = true;
    };
  }, [storageKey]);
  const caps = useQuery({
    queryKey: ['dashboard', 'clock-guest-permissions', tenantId, propertyId],
    enabled: source.data === 'CLOCK_PMS',
    queryFn: async () => {
      const r = await fetch(`${base}/capabilities/mine`, { credentials: 'include' });
      if (!r.ok) return [] as string[];
      return (await r.json()) as string[];
    },
  });
  const guests = useQuery({
    queryKey: ['dashboard', 'clock-guest-directory', tenantId, propertyId, term],
    enabled: open && source.data === 'CLOCK_PMS',
    queryFn: async () => {
      const r = await fetch(`${base}/clock-guests?search=${encodeURIComponent(term)}`, {
        credentials: 'include',
      });
      if (!r.ok) throw Error('Could not load Clock guest profiles.');
      return (await r.json()) as Guest[];
    },
  });
  if (source.data !== 'CLOCK_PMS') return null;
  const run = async () => {
    pause.current = false;
    setBusy(true);
    let current = progress ?? { updatedFrom: from, updatedUntil: until, cursor: '0', processed: 0 };
    try {
      while (!pause.current) {
        const r = await fetch(`${base}/clock-guests/import`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(current),
        });
        const data = await r.json();
        if (!r.ok)
          throw Error(
            data.message || 'Import paused. Check Clock personal-data bulk access, then resume.',
          );
        current = {
          ...current,
          cursor: data.cursor,
          processed: current.processed + data.processed,
        };
        setProgress(current);
        localStorage.setItem(storageKey, JSON.stringify(current));
        setMessage(`${current.processed} of ${data.total} guest records checked.`);
        if (data.completed) {
          localStorage.removeItem(storageKey);
          setProgress(null);
          setMessage(
            'Guest profile import complete. Profiles remain read-only; no guest email was sent.',
          );
          break;
        }
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Guest import paused.');
    } finally {
      setBusy(false);
      await client.invalidateQueries({ queryKey: ['dashboard'] });
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Clock guest directory</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Clock profiles include people without a MUST booking or email. Contact details stay
          read-only here. Importing does not merge profiles, create stays or send mail.
        </p>
        <Button variant="outline" onClick={() => setOpen(!open)}>
          {open ? 'Hide Clock profiles' : 'Show Clock profiles'}
        </Button>
        {caps.data?.includes('settings.manage') ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <label>
                Updated from
                <Input
                  aria-label="Guests updated from"
                  type="date"
                  value={from}
                  disabled={busy || !!progress}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label>
                Updated before
                <Input
                  aria-label="Guests updated before"
                  type="date"
                  value={until}
                  disabled={busy || !!progress}
                  onChange={(e) => setUntil(e.target.value)}
                />
              </label>
            </div>
            <div className="flex gap-2">
              <Button disabled={busy || from >= until} onClick={() => void run()}>
                {progress ? 'Resume guest import' : 'Import Clock guest profiles'}
              </Button>
              {busy ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    pause.current = true;
                  }}
                >
                  Pause after batch
                </Button>
              ) : progress ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    localStorage.removeItem(storageKey);
                    setProgress(null);
                  }}
                >
                  Choose another range
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        {message ? <p role="status">{message}</p> : null}
        {open ? (
          <>
            <Input
              aria-label="Search Clock guests"
              placeholder="Name, email or phone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {guests.error ? <p role="alert">{guests.error.message}</p> : null}
            {guests.isFetching ? <p role="status">Loading Clock profiles...</p> : null}
            {guests.data ? (
              <>
                <p className="text-xs">
                  Showing up to 500 matching imported profiles. Use search to narrow larger
                  directories.
                </p>
                <div className="max-h-80 overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Guest</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Last imported</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {guests.data.map((g) => (
                        <TableRow key={g.id}>
                          <TableCell>
                            {[g.firstName, g.lastName].filter(Boolean).join(' ') ||
                              'Name not supplied'}
                          </TableCell>
                          <TableCell>{g.email || 'No email supplied'}</TableCell>
                          <TableCell>{g.phone || 'No phone supplied'}</TableCell>
                          <TableCell>{new Date(g.syncedAt).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
