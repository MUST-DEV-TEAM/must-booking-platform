'use client';

import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { CalendarBoard } from '../calendar-board';
import type { Room, RoomType } from './room-management-types';

export type AvailabilityCalendarTarget =
  { kind: 'room-type'; roomType: RoomType } | { kind: 'room'; room: Room; roomType: RoomType };

/** The same reservation timeline used by Calendar, fixed to a room type or physical room. */
export function AvailabilityCalendarDialog({
  tenantId,
  propertyId,
  target,
  open,
  canBlock,
  canCreateBooking = false,
  onOpenChange,
}: {
  tenantId: string;
  propertyId: string;
  target: AvailabilityCalendarTarget | null;
  open: boolean;
  canBlock: boolean;
  canCreateBooking?: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[min(96vw,90rem)]">
        <DialogHeader>
          <DialogTitle>
            {target
              ? `${target.kind === 'room' ? target.room.name : target.roomType.name} calendar`
              : 'Availability calendar'}
          </DialogTitle>
          <DialogDescription>
            Reservations and blocks by room. Choose the first and last night of a range.{' '}
            {!canBlock && !canCreateBooking ? 'Read-only access.' : ''}
          </DialogDescription>
        </DialogHeader>
        {target ? (
          <CalendarBoard
            key={target.kind === 'room' ? target.room.id : target.roomType.id}
            tenantId={tenantId}
            propertyId={propertyId}
            embedded
            target={{
              roomTypeId: target.roomType.id,
              ...(target.kind === 'room' ? { roomId: target.room.id } : {}),
            }}
            canManageAvailability={canBlock}
            canCreateBooking={canCreateBooking}
          />
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
