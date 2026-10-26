'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { EmptyPanel, ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { MultiSelect } from '../../components/ui/multi-select';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { Switch } from '../../components/ui/switch';
import { inventoryRequest } from './inventory-api';

export type PromoCode = {
  id: string;
  code: string;
  kind: 'PERCENT' | 'FIXED';
  value: string;
  currency: string | null;
  description: string | null;
  bookFrom: string | null;
  bookUntil: string | null;
  stayFrom: string | null;
  stayUntil: string | null;
  minNights: number | null;
  roomTypeIds: string[];
  maxRedemptions: number | null;
  redemptions: number;
  active: boolean;
};
type Listing = { codes: PromoCode[]; clockCodes: string[] };
type RoomType = { id: string; name: string };

type Draft = {
  code: string;
  kind: 'PERCENT' | 'FIXED';
  value: string;
  description: string;
  bookFrom: string;
  bookUntil: string;
  stayFrom: string;
  stayUntil: string;
  minNights: string;
  maxRedemptions: string;
  roomTypeIds: string[];
  active: boolean;
};

const emptyDraft: Draft = {
  code: '',
  kind: 'PERCENT',
  value: '10',
  description: '',
  bookFrom: '',
  bookUntil: '',
  stayFrom: '',
  stayUntil: '',
  minNights: '',
  maxRedemptions: '',
  roomTypeIds: [],
  active: true,
};

const draftOf = (code: PromoCode): Draft => ({
  code: code.code,
  kind: code.kind,
  value: String(Number(code.value)),
  description: code.description ?? '',
  bookFrom: code.bookFrom ?? '',
  bookUntil: code.bookUntil ?? '',
  stayFrom: code.stayFrom ?? '',
  stayUntil: code.stayUntil ?? '',
  minNights: code.minNights === null ? '' : String(code.minNights),
  maxRedemptions: code.maxRedemptions === null ? '' : String(code.maxRedemptions),
  roomTypeIds: code.roomTypeIds,
  active: code.active,
});

/** The request body the API expects; empty fields mean "no limit". */
export function promoBody(draft: Draft) {
  const text = (value: string) => (value.trim() === '' ? null : value.trim());
  return {
    code: draft.code,
    kind: draft.kind,
    value: Number(draft.value),
    description: text(draft.description),
    bookFrom: text(draft.bookFrom),
    bookUntil: text(draft.bookUntil),
    stayFrom: text(draft.stayFrom),
    stayUntil: text(draft.stayUntil),
    minNights: text(draft.minNights) === null ? null : Number(draft.minNights),
    maxRedemptions: text(draft.maxRedemptions) === null ? null : Number(draft.maxRedemptions),
    roomTypeIds: draft.roomTypeIds.length > 0 ? draft.roomTypeIds : null,
    active: draft.active,
  };
}

/** A short sentence of what a code does and when it can be used. */
export function promoSummary(code: PromoCode, roomTypes: RoomType[]): string {
  const parts: string[] = [];
  parts.push(
    code.kind === 'PERCENT'
      ? `${Number(code.value)}% off`
      : `${code.value} ${code.currency ?? ''} off`,
  );
  if (code.bookFrom || code.bookUntil)
    parts.push(`bookable ${code.bookFrom ?? 'any time'} to ${code.bookUntil ?? 'any time'}`);
  if (code.stayFrom || code.stayUntil)
    parts.push(`stays ${code.stayFrom ?? 'any date'} to ${code.stayUntil ?? 'any date'}`);
  if (code.minNights) parts.push(`at least ${code.minNights} nights`);
  if (code.roomTypeIds.length > 0)
    parts.push(
      code.roomTypeIds
        .map((id) => roomTypes.find((type) => type.id === id)?.name ?? 'a room')
        .join(', '),
    );
  return parts.join(' · ');
}

/** The hotel's own promo codes: create, change and switch off. Clock bonus codes are listed, not edited. */
export function PromoCodesPanel({
  tenantId,
  propertyId,
  canEdit,
}: {
  tenantId: string;
  propertyId: string;
  canEdit: boolean;
}) {
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const queryClient = useQueryClient();
  const key = ['dashboard', 'promo-codes', tenantId, propertyId];
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const listing = useQuery({
    queryKey: key,
    queryFn: () => inventoryRequest<Listing>(`${base}/promo-codes`),
  });
  const roomTypes = useQuery({
    queryKey: ['dashboard', 'promo-room-types', tenantId, propertyId],
    queryFn: async () => {
      const response = await fetch(`${base}/room-types`, { credentials: 'include' });
      return response.ok ? ((await response.json()) as RoomType[]) : [];
    },
  });

  const save = useMutation({
    mutationFn: async (input: { id: string | null; draft: Draft }) =>
      inventoryRequest(`${base}/promo-codes${input.id ? `/${input.id}` : ''}`, {
        method: input.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(promoBody(input.draft)),
      }),
    onSuccess: async () => {
      setEditing(null);
      setFormError(null);
      await queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error: Error) => setFormError(error.message),
  });

  if (listing.isPending) return <ListSkeleton rows={3} />;
  if (listing.error)
    return (
      <ErrorPanel
        title="Promo codes could not be loaded"
        description={listing.error.message}
        onRetry={() => void listing.refetch()}
      />
    );

  const types = roomTypes.data ?? [];
  const { codes, clockCodes } = listing.data;
  const draft = editing?.draft;
  const setDraft = (patch: Partial<Draft>) =>
    setEditing((current) =>
      current ? { ...current, draft: { ...current.draft, ...patch } } : current,
    );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-lg">Promo codes</CardTitle>
          {canEdit ? (
            <Button onClick={() => setEditing({ id: null, draft: emptyDraft })}>New code</Button>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="m-0 text-sm text-muted-foreground">
            A guest or staff member types a code when booking. The server checks its rules and takes
            the discount off the price. The booking keeps the code, the discount and the price
            before it, and a hotel on Clock gets a note on the reservation.
          </p>
          {codes.length === 0 ? (
            <EmptyPanel
              title="No promo codes yet"
              description="Create a code to offer a percentage or a fixed amount off a stay."
            />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {codes.map((code) => (
                <li
                  key={code.id}
                  className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="m-0 text-sm font-semibold">
                      {code.code}{' '}
                      <Badge variant={code.active ? 'success' : 'muted'}>
                        {code.active ? 'On' : 'Off'}
                      </Badge>
                    </p>
                    <p className="m-0 text-sm text-muted-foreground">{promoSummary(code, types)}</p>
                    {code.description ? (
                      <p className="m-0 text-xs text-muted-foreground">{code.description}</p>
                    ) : null}
                    <p className="m-0 text-xs text-muted-foreground">
                      Used {code.redemptions}
                      {code.maxRedemptions ? ` of ${code.maxRedemptions}` : ''} time
                      {code.redemptions === 1 ? '' : 's'}
                    </p>
                  </div>
                  {canEdit ? (
                    <div className="flex shrink-0 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing({ id: code.id, draft: draftOf(code) })}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={save.isPending}
                        onClick={() =>
                          save.mutate({
                            id: code.id,
                            draft: { ...draftOf(code), active: !code.active },
                          })
                        }
                      >
                        {code.active ? 'Switch off' : 'Switch on'}
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {clockCodes.length > 0 ? (
        <Alert variant="info">
          <AlertTitle>Codes managed in Clock</AlertTitle>
          <AlertDescription>
            {clockCodes.join(', ')}. Guests can use these too: they are passed to Clock and the
            cheaper rate it returns is shown. Create and change them in Clock, not here.
          </AlertDescription>
        </Alert>
      ) : null}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? 'Edit promo code' : 'New promo code'}</DialogTitle>
            <DialogDescription>
              Leave a field empty for no limit. A fixed amount is in the hotel currency.
            </DialogDescription>
          </DialogHeader>
          {draft ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Code" htmlFor="promo-code" required className="sm:col-span-2">
                <Input
                  id="promo-code"
                  value={draft.code}
                  disabled={editing?.id !== null}
                  onChange={(event) => setDraft({ code: event.target.value.toUpperCase() })}
                  placeholder="SUMMER10"
                />
              </FormField>
              <FormField label="Discount type" htmlFor="promo-kind">
                <Select
                  value={draft.kind}
                  onValueChange={(value) => setDraft({ kind: value as Draft['kind'] })}
                >
                  <SelectTrigger id="promo-kind" aria-label="Discount type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENT">Percentage</SelectItem>
                    <SelectItem value="FIXED">Fixed amount</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField
                label={draft.kind === 'PERCENT' ? 'Percent off' : 'Amount off'}
                htmlFor="promo-value"
                required
              >
                <Input
                  id="promo-value"
                  inputMode="decimal"
                  value={draft.value}
                  onChange={(event) => setDraft({ value: event.target.value })}
                />
              </FormField>
              <FormField
                label="Booking from"
                htmlFor="promo-book-from"
                hint="First day it can be used."
              >
                <Input
                  id="promo-book-from"
                  type="date"
                  value={draft.bookFrom}
                  onChange={(event) => setDraft({ bookFrom: event.target.value })}
                />
              </FormField>
              <FormField
                label="Booking until"
                htmlFor="promo-book-until"
                hint="Last day it can be used."
              >
                <Input
                  id="promo-book-until"
                  type="date"
                  value={draft.bookUntil}
                  onChange={(event) => setDraft({ bookUntil: event.target.value })}
                />
              </FormField>
              <FormField label="Stay from" htmlFor="promo-stay-from" hint="Earliest check-in.">
                <Input
                  id="promo-stay-from"
                  type="date"
                  value={draft.stayFrom}
                  onChange={(event) => setDraft({ stayFrom: event.target.value })}
                />
              </FormField>
              <FormField label="Stay until" htmlFor="promo-stay-until" hint="Latest check-out.">
                <Input
                  id="promo-stay-until"
                  type="date"
                  value={draft.stayUntil}
                  onChange={(event) => setDraft({ stayUntil: event.target.value })}
                />
              </FormField>
              <FormField label="Minimum nights" htmlFor="promo-min">
                <Input
                  id="promo-min"
                  inputMode="numeric"
                  value={draft.minNights}
                  onChange={(event) => setDraft({ minNights: event.target.value })}
                />
              </FormField>
              <FormField
                label="Maximum uses"
                htmlFor="promo-max"
                hint="Cancelled bookings give a use back."
              >
                <Input
                  id="promo-max"
                  inputMode="numeric"
                  value={draft.maxRedemptions}
                  onChange={(event) => setDraft({ maxRedemptions: event.target.value })}
                />
              </FormField>
              <FormField
                label="Room types"
                className="sm:col-span-2"
                hint="None chosen means every room type."
              >
                <MultiSelect
                  label="Room types"
                  value={draft.roomTypeIds}
                  options={types.map((type) => ({ value: type.id, label: type.name }))}
                  onChange={(roomTypeIds) => setDraft({ roomTypeIds })}
                />
              </FormField>
              <FormField label="Note for staff" htmlFor="promo-note" className="sm:col-span-2">
                <Input
                  id="promo-note"
                  value={draft.description}
                  onChange={(event) => setDraft({ description: event.target.value })}
                />
              </FormField>
              <FormField label="Switched on" layout="toggle" className="sm:col-span-2">
                <Switch checked={draft.active} onCheckedChange={(active) => setDraft({ active })} />
              </FormField>
            </div>
          ) : null}
          {formError ? (
            <p role="alert" className="m-0 text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={save.isPending || !draft?.code || !draft.value}
              onClick={() => editing && save.mutate(editing)}
            >
              {save.isPending ? 'Saving…' : 'Save code'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
