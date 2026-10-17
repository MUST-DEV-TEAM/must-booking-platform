'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { ImageIcon, Plus, Trash2 } from 'lucide-react';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { FormField } from '../../../components/ui/form-field';
import { Input, Textarea } from '../../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import {
  amenityIconLabel,
  amenityIcons,
  type Amenity,
  type AmenityIcon,
  type Room,
  type RoomForm,
  type RoomType,
  type RoomTypeForm,
} from './room-management-types';
import { amenityIconCatalog } from './amenity-icon-catalog';
import { PropertyImageLibraryDialog } from './property-image-library';
import { RoomTypeMainImageSelector } from './room-type-main-image-selector';
import { RoomTypePhotoGallery } from './room-type-photo-gallery';
import type { RoomTypeImage } from './room-management-types';

/** Dialog for adding or editing a sellable room type. */
export function RoomTypeEditorDialog({
  tenantId,
  propertyId,
  roomType,
  images,
  canManageAccommodations,
  canManagePhotos,
  open,
  saving,
  onOpenChange,
  onSave,
}: {
  tenantId: string;
  propertyId: string;
  roomType: RoomType | null;
  images: RoomTypeImage[];
  canManageAccommodations: boolean;
  canManagePhotos: boolean;
  open: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (form: RoomTypeForm) => void;
}) {
  const [form, setForm] = useState<RoomTypeForm>(() => roomTypeForm(roomType));
  const [libraryOpen, setLibraryOpen] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(form);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[42rem]">
        <DialogHeader>
          <DialogTitle>{roomType ? 'Edit room type' : 'Add room type'}</DialogTitle>
          <DialogDescription>
            Manage the guest-facing room type details and occupancy.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FormField label="Name" htmlFor="room-type-name" required>
            <Input
              id="room-type-name"
              required
              disabled={!canManageAccommodations}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </FormField>
          <FormField label="Description" htmlFor="room-type-description">
            <Textarea
              id="room-type-description"
              disabled={!canManageAccommodations}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </FormField>
          <FormField label="Amenities introduction" htmlFor="room-type-amenities-intro">
            <Textarea
              id="room-type-amenities-intro"
              disabled={!canManageAccommodations}
              value={form.amenitiesIntro}
              onChange={(event) => setForm({ ...form, amenitiesIntro: event.target.value })}
            />
          </FormField>
          <FormField label="Maximum occupancy" htmlFor="room-type-max-occupancy" required>
            <Input
              id="room-type-max-occupancy"
              required
              min="1"
              type="number"
              disabled={!canManageAccommodations}
              value={form.maxOccupancy}
              onChange={(event) => setForm({ ...form, maxOccupancy: event.target.value })}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {canManageAccommodations ? (
              <Button type="submit" loading={saving}>
                {roomType ? (
                  'Save room type'
                ) : (
                  <>
                    <Plus aria-hidden="true" /> Add room type
                  </>
                )}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
        {roomType && canManagePhotos ? (
          <section className="flex flex-col gap-4 border-t pt-4" aria-label="Room type photos">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="m-0 text-sm font-bold">Photos</h3>
                <p className="m-0 mt-1 text-xs text-muted-foreground">
                  Choose a main image and manage the room gallery.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setLibraryOpen(true)}
              >
                <ImageIcon aria-hidden="true" /> Photo library
              </Button>
            </div>
            <RoomTypeMainImageSelector
              tenantId={tenantId}
              propertyId={propertyId}
              roomTypeId={roomType.id}
              roomTypeName={roomType.name}
              images={images}
            />
            <RoomTypePhotoGallery
              tenantId={tenantId}
              propertyId={propertyId}
              roomTypeId={roomType.id}
              images={images}
            />
            {libraryOpen ? (
              <PropertyImageLibraryDialog
                tenantId={tenantId}
                propertyId={propertyId}
                mode="manage"
                title="Photo library"
                onClose={() => setLibraryOpen(false)}
              />
            ) : null}
          </section>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** Dialog for adding or editing a physical room. */
export function RoomEditorDialog({
  roomType,
  room,
  canManageAccommodations,
  open,
  saving,
  onOpenChange,
  onSave,
}: {
  roomType: RoomType | null;
  room: Room | null;
  canManageAccommodations: boolean;
  open: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (form: RoomForm) => void;
}) {
  const [form, setForm] = useState<RoomForm>(() => roomForm(room));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(form);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[42rem]">
        <DialogHeader>
          <DialogTitle>{room ? 'Edit physical room' : 'Add physical room'}</DialogTitle>
          <DialogDescription>{roomType?.name ?? 'Choose a room type first'}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <FormField label="Room name" htmlFor="physical-room-name" required>
            <Input
              id="physical-room-name"
              required
              disabled={!canManageAccommodations}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </FormField>
          <FormField label="Display title" htmlFor="physical-room-title">
            <Input
              id="physical-room-title"
              disabled={!canManageAccommodations}
              maxLength={200}
              placeholder="e.g. Deluxe Sea Suite"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </FormField>
          <FormField label="Room size" htmlFor="physical-room-size">
            <Input
              id="physical-room-size"
              disabled={!canManageAccommodations}
              maxLength={50}
              placeholder="e.g. 70m²"
              value={form.roomSize}
              onChange={(event) => setForm({ ...form, roomSize: event.target.value })}
            />
          </FormField>
          <FormField label="Floor" htmlFor="physical-room-floor">
            <Input
              id="physical-room-floor"
              type="number"
              disabled={!canManageAccommodations}
              min="-10"
              max="200"
              value={form.floor}
              onChange={(event) => setForm({ ...form, floor: event.target.value })}
            />
          </FormField>
          <FormField label="View type" htmlFor="physical-room-view">
            <Input
              id="physical-room-view"
              disabled={!canManageAccommodations}
              maxLength={100}
              placeholder="e.g. Sea view"
              value={form.viewType}
              onChange={(event) => setForm({ ...form, viewType: event.target.value })}
            />
          </FormField>
          <div className="sm:col-span-2">
            <FormField
              label="Room rules override"
              htmlFor="physical-room-rules"
              hint="Replaces the property room rules for this room only"
            >
              <Textarea
                id="physical-room-rules"
                disabled={!canManageAccommodations}
                value={form.rules}
                onChange={(event) => setForm({ ...form, rules: event.target.value })}
              />
            </FormField>
          </div>
          <div className="sm:col-span-2">
            <FormField
              label="Room description override"
              htmlFor="physical-room-description"
              hint="Replaces the room type description for this room only"
            >
              <Textarea
                id="room-type-description"
                disabled={!canManageAccommodations}
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </FormField>
          </div>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {canManageAccommodations ? (
              <Button type="submit" loading={saving}>
                {room ? (
                  'Save room'
                ) : (
                  <>
                    <Plus aria-hidden="true" /> Add physical room
                  </>
                )}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Dialog for creating and removing the property's existing amenity records. */
export function AmenitiesDialog({
  amenities,
  canManageAccommodations,
  open,
  saving,
  onOpenChange,
  onCreate,
  onDelete,
}: {
  amenities: Amenity[];
  canManageAccommodations: boolean;
  open: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, icon: AmenityIcon) => Promise<void>;
  onDelete: (amenityId: string) => void;
}) {
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<AmenityIcon>('WIFI');
  const suggestions: Array<{ name: string; icon: AmenityIcon }> = [
    { name: 'Hair dryer', icon: 'HAIR_DRYER' },
    { name: 'Kettle and coffee', icon: 'KETTLE_COFFEE' },
    { name: 'Minibar', icon: 'MINIBAR' },
    { name: 'Balcony', icon: 'BALCONY' },
    { name: 'Sea view', icon: 'SEA_VIEW' },
    { name: 'Safe', icon: 'SAFE' },
    { name: 'Bathrobe', icon: 'BATHROBE' },
    { name: 'Crib', icon: 'CRIB' },
    { name: 'Room service', icon: 'ROOM_SERVICE' },
    { name: 'Pets allowed', icon: 'PETS_ALLOWED' },
    { name: 'EV charging', icon: 'EV_CHARGING' },
    { name: 'Smart TV', icon: 'SMART_TV' },
  ];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      await onCreate(name.trim(), icon);
      setName('');
      setIcon('WIFI');
    } catch {
      // The mutation reports the failure to the user.
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[34rem]">
        <DialogHeader>
          <DialogTitle>Property amenities</DialogTitle>
          <DialogDescription>
            Create amenities, then assign them to room types or rooms.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <FormField label="Amenity name" htmlFor="amenity-name" required>
            <Input
              id="amenity-name"
              required
              disabled={!canManageAccommodations}
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FormField>
          <FormField label="Icon" htmlFor="amenity-icon">
            <Select
              value={icon}
              onValueChange={(value) => setIcon(value as AmenityIcon)}
              disabled={!canManageAccommodations}
            >
              <SelectTrigger id="amenity-icon" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {amenityIcons.map((item) => (
                  <SelectItem key={item} value={item}>
                    <span className="flex items-center gap-2">
                      {(() => {
                        const Icon = amenityIconCatalog[item].icon;
                        return <Icon aria-hidden="true" className="size-4" />;
                      })()}
                      {amenityIconLabel(item)}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {canManageAccommodations ? (
            <Button type="submit" loading={saving}>
              <Plus aria-hidden="true" /> Add
            </Button>
          ) : null}
        </form>
        <section aria-label="Suggested amenities" className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-semibold">Suggested amenities</h3>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => {
              const Icon = amenityIconCatalog[suggestion.icon].icon;
              const alreadyAdded = amenities.some(
                (amenity) => amenity.name.toLowerCase() === suggestion.name.toLowerCase(),
              );
              return (
                <Button
                  key={suggestion.icon}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canManageAccommodations || saving || alreadyAdded}
                  onClick={() =>
                    void onCreate(suggestion.name, suggestion.icon).catch(() => undefined)
                  }
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {suggestion.name}
                  {alreadyAdded ? ' · Added' : ''}
                </Button>
              );
            })}
          </div>
        </section>
        <ul className="m-0 flex flex-col gap-2 p-0">
          {amenities.map((amenity) => (
            <li
              key={amenity.id}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-semibold">{amenity.name}</span>
                <Badge variant="muted">
                  {amenity.icon ? amenityIconLabel(amenity.icon) : 'No icon'}
                </Badge>
              </span>
              {canManageAccommodations ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete ${amenity.name}`}
                  onClick={() => onDelete(amenity.id)}
                >
                  <Trash2 aria-hidden="true" /> Delete
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function roomTypeForm(roomType: RoomType | null): RoomTypeForm {
  return roomType
    ? {
        name: roomType.name,
        description: roomType.description ?? '',
        amenitiesIntro: roomType.amenitiesIntro ?? '',
        maxOccupancy: String(roomType.maxOccupancy),
      }
    : { name: '', description: '', amenitiesIntro: '', maxOccupancy: '2' };
}

function roomForm(room: Room | null): RoomForm {
  return room
    ? {
        name: room.name,
        title: room.title ?? '',
        roomSize: room.roomSize ?? '',
        rules: room.rules ?? '',
        description: room.description ?? '',
        floor: room.floor === null ? '' : String(room.floor),
        viewType: room.viewType ?? '',
      }
    : { name: '', title: '', roomSize: '', rules: '', description: '', floor: '', viewType: '' };
}
