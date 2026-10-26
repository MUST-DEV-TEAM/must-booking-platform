'use client';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '../../components/ui/card';
import { Combobox } from '../../components/ui/combobox';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';
import { inventoryRequest } from './inventory-api';
import type { CatalogItem } from './inventory-types';
import { DateField } from '../../components/ui/date-field';
/** Tests a saved-rule stay through the server evaluator, without holding inventory. */
export function InventoryPreview({
  base,
  catalog,
  rooms,
  today,
  bookingMode,
}: {
  base: string;
  catalog: CatalogItem[];
  rooms: CatalogItem[];
  today: string;
  bookingMode: string;
}) {
  const [roomTypeId, setType] = useState(catalog[0]?.id ?? ''),
    [roomId, setRoom] = useState(''),
    [startsOn, setStart] = useState(today),
    [endsOn, setEnd] = useState(''),
    [channel, setChannel] = useState('staff'),
    [adults, setAdults] = useState(1),
    [children, setChildren] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<{
      valid: boolean;
      errors: { code: string; message: string }[];
    } | null>(null);
  const reset = () => {
    setResult(null);
    setError('');
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Booking effect preview</CardTitle>
        <CardDescription>
          Tests enabled saved rules and current availability. Activate a draft before testing its
          effect. No stock is held and prices are not checked.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            setResult(null);
            try {
              const data = await inventoryRequest<{
                booking: { valid: boolean; errors: { code: string; message: string }[] };
              }>(`${base}/preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  roomTypeId,
                  ...(roomId ? { roomId } : {}),
                  startsOn,
                  endsOn,
                  channel,
                  adults,
                  children,
                }),
              });
              setResult(data.booking);
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Preview failed.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <FormField label="Room type">
              <Combobox
                label="Preview room type"
                options={catalog.map((t) => ({ value: t.id, label: t.name }))}
                value={roomTypeId}
                onChange={(v) => {
                  setType(v);
                  setRoom('');
                  reset();
                }}
              />
            </FormField>
            {bookingMode !== 'ROOM_TYPE_ONLY' ? (
              <FormField
                label="Room"
                hint={
                  bookingMode === 'INDIVIDUAL_ROOM_ONLY'
                    ? 'Choose a room for physical-room eligibility.'
                    : 'Optional; choose a room to check that specific unit.'
                }
              >
                <Combobox
                  label="Preview room"
                  options={[
                    { value: '', label: 'No specific room' },
                    ...rooms
                      .filter((r) => r.roomTypeId === roomTypeId)
                      .map((r) => ({ value: r.id, label: r.name })),
                  ]}
                  value={roomId}
                  onChange={(v) => {
                    setRoom(v);
                    reset();
                  }}
                />
              </FormField>
            ) : null}
            <FormField label="Booking channel">
              <Combobox
                label="Preview channel"
                options={[
                  { value: 'staff', label: 'Staff' },
                  { value: 'guest', label: 'Website' },
                ]}
                value={channel}
                onChange={(v) => {
                  setChannel(v);
                  reset();
                }}
              />
            </FormField>
            <FormField label="Arrival" htmlFor="preview-arrival">
              <DateField
                id="preview-arrival"
              aria-label="Arrival"
                value={startsOn}
                onChange={(date) => {
                  setStart(date);
                  reset();
                }}
              />
            </FormField>
            <FormField label="Departure" htmlFor="preview-departure">
              <DateField
                id="preview-departure"
              aria-label="Departure"
                value={endsOn}
                onChange={(date) => {
                  setEnd(date);
                  reset();
                }}
              />
            </FormField>
            <FormField label="Adults" htmlFor="preview-adults">
              <Input
                id="preview-adults"
                type="number"
                min={1}
                required
                value={adults}
                onChange={(e) => {
                  setAdults(Number(e.target.value));
                  reset();
                }}
              />
            </FormField>
            <FormField label="Children" htmlFor="preview-children">
              <Input
                id="preview-children"
                type="number"
                min={0}
                required
                value={children}
                onChange={(e) => {
                  setChildren(Number(e.target.value));
                  reset();
                }}
              />
            </FormField>
          </div>
          <Button
            type="submit"
            className="self-start"
            disabled={busy || !roomTypeId || (bookingMode === 'INDIVIDUAL_ROOM_ONLY' && !roomId)}
          >
            {busy ? 'Checking...' : 'Test stay'}
          </Button>
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Preview could not complete</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {result ? (
            <Alert>
              <AlertTitle>{result.valid ? 'Passes saved rules' : 'Stay rejected'}</AlertTitle>
              <AlertDescription>
                {result.valid
                  ? 'Currently eligible. Availability is checked again when booking.'
                  : result.errors.map((e) => e.message).join(' ')}
              </AlertDescription>
            </Alert>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
