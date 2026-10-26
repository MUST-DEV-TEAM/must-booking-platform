'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { DetailList } from '../../components/ui/detail-list';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import { FormField } from '../../components/ui/form-field';
import { Input, Textarea } from '../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';

export const BLOCK_REASON_LABELS = {
  maintenance: 'Maintenance',
  renovation: 'Renovation',
  safety_inspection: 'Safety inspection',
  deep_cleaning: 'Deep cleaning',
  out_of_service: 'Out of service',
  owner_use: 'Owner use',
  house_use: 'House or staff use',
  event: 'Event',
  other: 'Other',
} as const;
export type BlockReason = keyof typeof BLOCK_REASON_LABELS;

type Conflict = {
  id: string;
  externalReference: string;
  startsOn: string;
  endsOn: string;
  guestName: string | null;
  roomName: string | null;
};

const longDate = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(
    new Date(`${iso}T00:00:00`),
  );

/**
 * Takes a room (or a whole room type) out of sale for some nights, with a reason. A block never
 * cancels or moves a reservation: if one is in the way the server refuses and this lists them.
 */
export function BlockDialog({
  open,
  onOpenChange,
  tenantId,
  propertyId,
  startsOn,
  endsOn,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  propertyId: string;
  startsOn: string;
  endsOn: string;
  target: { label: string; roomId?: string; roomTypeId: string };
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState<BlockReason | ''>('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [conflicts, setConflicts] = useState<Conflict[]>([]);

  const create = useMutation({
    mutationFn: async () => {
      setConflicts([]);
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/availability-blocks`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startsOn,
            endsOn,
            all: false,
            ...(target.roomId
              ? { roomIds: [target.roomId] }
              : { roomTypeIds: [target.roomTypeId] }),
            reason,
            reference: reference.trim() || undefined,
            note: note.trim() || undefined,
          }),
        },
      );
      if (response.ok) return;
      const body = (await response.json().catch(() => null)) as {
        message?: string | string[];
        conflicts?: Conflict[];
      } | null;
      if (body?.conflicts?.length) setConflicts(body.conflicts);
      throw new Error(
        Array.isArray(body?.message)
          ? body.message.join(' ')
          : (body?.message ?? 'The block could not be saved.'),
      );
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setReason('');
      setReference('');
      setNote('');
      onOpenChange(false);
    },
  });

  const nights = Math.round(
    (new Date(`${endsOn}T00:00:00Z`).getTime() - new Date(`${startsOn}T00:00:00Z`).getTime()) /
      86_400_000,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!create.isPending) {
          if (!next) {
            create.reset();
            setConflicts([]);
          }
          onOpenChange(next);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Block availability</DialogTitle>
          <DialogDescription>
            Take it out of sale. Existing reservations are never cancelled or moved by a block.
          </DialogDescription>
        </DialogHeader>
        <DetailList
          items={[
            { label: 'What', value: target.label },
            { label: 'From', value: longDate(startsOn) },
            { label: 'Available again', value: longDate(endsOn) },
            { label: 'Nights blocked', value: nights },
          ]}
        />
        <FormField label="Reason" htmlFor="block-reason" required>
          <Select value={reason} onValueChange={(value) => setReason(value as BlockReason)}>
            <SelectTrigger id="block-reason" aria-label="Reason" className="w-full">
              <SelectValue placeholder="Choose a reason" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(BLOCK_REASON_LABELS) as BlockReason[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {BLOCK_REASON_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField
          label="Reference"
          htmlFor="block-reference"
          hint="Optional, for example a work-order number."
        >
          <Input
            id="block-reference"
            maxLength={80}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
        </FormField>
        <FormField label="Internal note" htmlFor="block-note" hint="Optional. Only staff see it.">
          <Textarea
            id="block-note"
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </FormField>
        {create.isError ? (
          <Alert variant="destructive">
            <AlertTitle>The block was not saved</AlertTitle>
            <AlertDescription>
              <span>{create.error.message}</span>
              {conflicts.length > 0 ? (
                <ul className="m-0 mt-1 list-disc pl-4 text-xs">
                  {conflicts.map((conflict) => (
                    <li key={conflict.id}>
                      {conflict.externalReference} · {conflict.guestName ?? 'Guest'}
                      {conflict.roomName ? ` · ${conflict.roomName}` : ''} ·{' '}
                      {longDate(conflict.startsOn)} – {longDate(conflict.endsOn)}
                    </li>
                  ))}
                </ul>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button onClick={() => create.mutate()} disabled={!reason} loading={create.isPending}>
            Block these nights
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
