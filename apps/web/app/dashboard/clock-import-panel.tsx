'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePmsSource } from './use-pms-source';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { DateField } from '../../components/ui/date-field';
type Progress = {
  startsOn: string;
  endsOn: string;
  windowStart: string;
  cursor: string;
  processed: number;
};
export function ClockImportPanel({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const source = usePmsSource(tenantId, propertyId);
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const client = useQueryClient();
  const caps = useQuery({
    queryKey: ['dashboard', 'clock-import-permissions', tenantId, propertyId],
    enabled: source.data === 'CLOCK_PMS',
    queryFn: async () => {
      const r = await fetch(`${base}/capabilities/mine`, { credentials: 'include' });
      if (!r.ok) throw new Error('Could not load import permissions.');
      return (await r.json()) as string[];
    },
  });
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today),
    [to, setTo] = useState(new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10));
  const [progress, setProgress] = useState<Progress | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const pause = useRef(false);
  const storageKey = `clock-import:${tenantId}:${propertyId}`;
  useEffect(() => {
    setProgress(null);
    setMessage('');
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null') as Progress | null;
      if (saved) {
        setProgress(saved);
        setFrom(saved.startsOn);
        setTo(saved.endsOn);
      }
    } catch {
      // Saved filters are optional; fall back to the defaults.
    }
    return () => {
      pause.current = true;
    };
  }, [storageKey]);
  if (source.data !== 'CLOCK_PMS' || !caps.data?.includes('settings.manage')) return null;
  const run = async () => {
    pause.current = false;
    setBusy(true);
    setMessage('Reading Clock in small batches?');
    let current = progress ?? {
      startsOn: from,
      endsOn: to,
      windowStart: from,
      cursor: '0',
      processed: 0,
    };
    try {
      while (!pause.current) {
        const r = await fetch(`${base}/clock-import`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(current),
        });
        const data = await r.json();
        if (!r.ok)
          throw new Error(data.message || 'Import stopped. Resume to retry the same batch.');
        current = { ...current, ...data.next, processed: current.processed + data.outcomes.length };
        setProgress(current);
        localStorage.setItem(storageKey, JSON.stringify(current));
        if (data.blocked) {
          setMessage(
            'Import paused: a Clock status or room mapping needs review. Fix it in Connections, then resume.',
          );
          break;
        }
        if (data.completed) {
          localStorage.removeItem(storageKey);
          setProgress(null);
          setMessage(
            'Import complete. Bookings and available guest details are updated; no historical emails were sent.',
          );
          break;
        }
        setMessage(`${current.processed} booking records checked. Reading the next batch?`);
      }
      if (pause.current) setMessage('Paused. Resume continues from the last saved batch.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Import could not finish.');
    } finally {
      setBusy(false);
      await client.invalidateQueries({ queryKey: ['dashboard'] });
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Import bookings and guests from Clock</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Read-only at Clock. Imports stays overlapping your dates and their available guest
          details. Repeat imports update existing records. Payments are not recreated. Guests
          without bookings in this range are not included.
        </p>
        <div className="flex flex-wrap gap-3">
          <label>
            From
            <DateField
              aria-label="Import from"

              value={from}
              disabled={busy || !!progress}
              onChange={(date) => setFrom(date)}
            />
          </label>
          <label>
            Until (checkout boundary)
            <DateField
              aria-label="Import until"

              value={to}
              disabled={busy || !!progress}
              onChange={(date) => setTo(date)}
            />
          </label>
        </div>
        <div className="flex gap-2">
          <Button disabled={busy || !from || !to || from >= to} onClick={() => void run()}>
            {progress ? 'Resume import' : 'Start import'}
          </Button>
          {busy ? (
            <Button
              variant="outline"
              onClick={() => {
                pause.current = true;
              }}
            >
              Pause after this batch
            </Button>
          ) : progress ? (
            <Button
              variant="outline"
              onClick={() => {
                localStorage.removeItem(storageKey);
                setProgress(null);
                setMessage('');
              }}
            >
              Choose another range
            </Button>
          ) : null}
        </div>
        {message ? <p role="status">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
