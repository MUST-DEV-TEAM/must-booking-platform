'use client';

import { MoreHorizontal, Plus } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent } from '../../../components/ui/card';
import { Checkbox } from '../../../components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import type { Amenity, Room, RoomManagementData, RoomType } from './room-management-types';
import { amenityIconCatalog } from './amenity-icon-catalog';

export function SummaryTile({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  detail: string;
}) {
  return (
    <Card className="gap-2 py-4">
      <CardContent className="flex items-start justify-between gap-3 px-4">
        <div>
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="m-0 mt-1 text-2xl font-bold tabular-nums">{value}</p>
          <p className="m-0 mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <span className="rounded-lg bg-secondary p-2 text-primary">
          <Icon aria-hidden="true" className="size-4" />
        </span>
      </CardContent>
    </Card>
  );
}

export function CompactAmenities({ amenities }: { amenities: Amenity[] }) {
  if (!amenities.length) return <span className="text-xs text-muted-foreground">None</span>;
  return (
    <span className="flex flex-wrap gap-2 text-xs">
      {amenities.slice(0, 2).map((item) => {
        const Icon = item.icon ? amenityIconCatalog[item.icon].icon : null;
        return (
          <span key={item.id} className="inline-flex items-center gap-1">
            {Icon ? <Icon aria-hidden="true" className="size-3.5" /> : null}
            {item.name}
          </span>
        );
      })}
      {amenities.length > 2 ? ` +${amenities.length - 2}` : ''}
    </span>
  );
}

export function RowActions({
  onPeek,
  onDetails,
  onCalendar,
  onEdit,
  onDelete,
  onDuplicate,
  onAddRoom,
  canManageAccommodations,
  canManagePhotos,
  canViewCalendar,
}: {
  onPeek: () => void;
  onDetails: () => void;
  onCalendar: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAddRoom: () => void;
  canManageAccommodations: boolean;
  canManagePhotos: boolean;
  canViewCalendar: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Room type actions">
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onPeek}>View details</DropdownMenuItem>
        <DropdownMenuItem onSelect={onDetails}>Open full details</DropdownMenuItem>
        {canViewCalendar ? (
          <DropdownMenuItem onSelect={onCalendar}>Calendar</DropdownMenuItem>
        ) : null}
        {canManageAccommodations ? (
          <DropdownMenuItem onSelect={onEdit}>Edit details</DropdownMenuItem>
        ) : null}
        {canManageAccommodations ? (
          <DropdownMenuItem onSelect={onAddRoom}>Add physical room</DropdownMenuItem>
        ) : null}
        {canManageAccommodations ? (
          <DropdownMenuItem onSelect={onDuplicate}>Duplicate room type</DropdownMenuItem>
        ) : null}
        {canManagePhotos ? (
          <DropdownMenuItem onSelect={onEdit}>Manage photos</DropdownMenuItem>
        ) : null}
        {canManageAccommodations ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              Delete room type
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function RoomRowActions({
  room,
  onPeek,
  onCalendar,
  onEdit,
  onDelete,
  canManageAccommodations,
  canViewCalendar,
}: {
  room: Room;
  onPeek: () => void;
  onCalendar: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canManageAccommodations: boolean;
  canViewCalendar: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${room.name}`}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onPeek}>View details</DropdownMenuItem>
        {canViewCalendar ? (
          <DropdownMenuItem onSelect={onCalendar}>Calendar</DropdownMenuItem>
        ) : null}
        {canManageAccommodations ? (
          <>
            <DropdownMenuItem onSelect={onEdit}>Edit room</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              Delete room
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RoomTypePeek({
  data,
  roomType,
  canManageAccommodations,
  canManagePhotos,
  onAddRoom,
  onEditRoom,
  onToggleAmenity,
}: {
  data: RoomManagementData;
  roomType: RoomType;
  canManageAccommodations: boolean;
  canManagePhotos: boolean;
  onAddRoom: (roomType: RoomType) => void;
  onEditRoom: (roomType: RoomType, room: Room) => void;
  onToggleAmenity: (roomTypeId: string, amenityId: string) => void;
}) {
  const assigned = data.roomTypeAmenities[roomType.id] ?? [];
  const rooms = data.rooms[roomType.id] ?? [];
  const photos = data.images[roomType.id] ?? [];
  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-3 py-4">
        <CardContent className="flex flex-col gap-3 px-4">
          <h3 className="m-0 text-sm font-bold">Overview</h3>
          <DetailLine label="Maximum occupancy" value={`${roomType.maxOccupancy} guests`} />
          <DetailLine label="Physical rooms" value={String(rooms.length)} />
          {roomType.description ? (
            <DetailLine label="Description" value={roomType.description} />
          ) : null}
          {roomType.amenitiesIntro ? (
            <DetailLine label="Amenities introduction" value={roomType.amenitiesIntro} />
          ) : null}
        </CardContent>
      </Card>
      {canManagePhotos ? (
        <Card className="gap-3 py-4">
          <CardContent className="flex flex-col gap-3 px-4">
            <h3 className="m-0 text-sm font-bold">
              Photos{' '}
              <span className="text-xs font-normal text-muted-foreground">{photos.length}</span>
            </h3>
            {photos.length ? (
              <div className="grid grid-cols-3 gap-2">
                {photos.slice(0, 6).map((photo) => (
                  <div
                    key={photo.id}
                    className="relative aspect-[4/3] overflow-hidden rounded-md bg-muted"
                  >
                    <img
                      src={photo.url}
                      alt={`${roomType.name} room`}
                      className="size-full object-cover"
                    />
                    {photo.isPrimary ? (
                      <Badge className="absolute top-1 left-1" variant="success">
                        Main
                      </Badge>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="m-0 text-sm text-muted-foreground">No photos added yet.</p>
            )}
          </CardContent>
        </Card>
      ) : null}
      <Card className="gap-3 py-4">
        <CardContent className="flex flex-col gap-3 px-4">
          <h3 className="m-0 text-sm font-bold">Amenities</h3>
          {assigned.length ? (
            <div className="flex flex-wrap gap-2">
              {assigned.map((item) => (
                <Badge key={item.id} variant="muted">
                  {item.name}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="m-0 text-sm text-muted-foreground">No amenities selected.</p>
          )}
          {canManageAccommodations ? (
            <div className="flex flex-col gap-2 border-t pt-3">
              {data.amenities.map((amenity) => (
                <label key={amenity.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={assigned.some((item) => item.id === amenity.id)}
                    onCheckedChange={() => onToggleAmenity(roomType.id, amenity.id)}
                  />
                  {amenity.name}
                </label>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card className="gap-3 py-4">
        <CardContent className="flex flex-col gap-3 px-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="m-0 text-sm font-bold">Physical rooms</h3>
            {canManageAccommodations ? (
              <Button size="sm" variant="outline" onClick={() => onAddRoom(roomType)}>
                <Plus aria-hidden="true" /> Add
              </Button>
            ) : null}
          </div>
          {rooms.length ? (
            <ul className="m-0 flex flex-col gap-2 p-0">
              {rooms.map((room) => (
                <li
                  key={room.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{room.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {[room.viewType, room.floor !== null ? `Floor ${room.floor}` : null]
                        .filter(Boolean)
                        .join(' Â· ') || 'Details not set'}
                    </span>
                  </span>
                  {canManageAccommodations ? (
                    <Button size="sm" variant="ghost" onClick={() => onEditRoom(roomType, room)}>
                      Edit
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-sm text-muted-foreground">No physical rooms added yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function RoomPeek({
  data,
  room,
  roomType,
  customizing,
  canManageAccommodations,
  onToggleAmenity,
  onCustomize,
  onInherit,
}: {
  data: RoomManagementData;
  room: Room;
  roomType: RoomType;
  customizing: boolean;
  canManageAccommodations: boolean;
  onToggleAmenity: (roomId: string, amenityId: string) => void;
  onCustomize: (roomId: string, inherited: Amenity[]) => void;
  onInherit: (roomId: string) => void;
}) {
  const custom = data.roomAmenities[room.id] ?? [];
  const effective = customizing ? custom : (data.roomTypeAmenities[roomType.id] ?? []);
  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-3 py-4">
        <CardContent className="flex flex-col gap-3 px-4">
          <h3 className="m-0 text-sm font-bold">Room details</h3>
          <DetailLine label="Room type" value={roomType.name} />
          {room.title ? <DetailLine label="Display title" value={room.title} /> : null}
          <DetailLine label="Floor" value={room.floor === null ? 'Not set' : String(room.floor)} />
          <DetailLine label="View" value={room.viewType || 'Not set'} />
          <DetailLine label="Room size" value={room.roomSize || 'Not set'} />
          {room.description ? (
            <DetailLine label="Description override" value={room.description} />
          ) : null}
          {room.rules ? <DetailLine label="Rules override" value={room.rules} /> : null}
        </CardContent>
      </Card>
      <Card className="gap-3 py-4">
        <CardContent className="flex flex-col gap-3 px-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="m-0 text-sm font-bold">Amenities</h3>
            <Badge variant={customizing ? 'info' : 'muted'}>
              {customizing ? 'Custom' : 'Inherited'}
            </Badge>
          </div>
          <p className="m-0 text-xs text-muted-foreground">
            {customizing
              ? 'This room has its own amenity selection.'
              : `Using the amenities assigned to ${roomType.name}.`}
          </p>
          <div className="flex flex-wrap gap-2">
            {effective.map((item) => (
              <Badge key={item.id} variant="muted">
                {item.name}
              </Badge>
            ))}
            {effective.length === 0 ? (
              <span className="text-sm text-muted-foreground">No amenities selected.</span>
            ) : null}
          </div>
          {canManageAccommodations && customizing ? (
            <>
              <Button variant="outline" size="sm" onClick={() => onInherit(room.id)}>
                Inherit room type amenities
              </Button>
              <div className="flex flex-col gap-2 border-t pt-3">
                {data.amenities.map((amenity) => (
                  <label key={amenity.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={custom.some((item) => item.id === amenity.id)}
                      onCheckedChange={() => onToggleAmenity(room.id, amenity.id)}
                    />
                    {amenity.name}
                  </label>
                ))}
              </div>
            </>
          ) : canManageAccommodations ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onCustomize(room.id, data.roomTypeAmenities[roomType.id] ?? [])}
            >
              Customize amenities
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b pb-2 last:border-0 last:pb-0">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <span className="whitespace-pre-wrap text-sm">{value}</span>
    </div>
  );
}
