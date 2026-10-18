'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { ImageIcon, Plus } from 'lucide-react';

import { AmenityMultiSelect } from '../../../components/ui/amenity-multi-select';
import { amenitySelectOptions, suggestedAmenityOptions } from './amenity-select-options';
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
import { Switch } from '../../../components/ui/switch';
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
  type CreateAmenity,
  type AmenityIcon,
  type Room,
  type RoomCategory,
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
  categories,
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
  categories: RoomCategory[];
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
          <FormField
            label="House rules"
            htmlFor="room-type-house-rules"
            hint="Shown to guests on the booking page"
          >
            <Textarea
              id="room-type-house-rules"
              disabled={!canManageAccommodations}
              value={form.rules}
              onChange={(event) => setForm({ ...form, rules: event.target.value })}
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
          <FormField label="Category" htmlFor="room-type-category">
            <Select
              value={form.categoryId || 'none'}
              onValueChange={(categoryId) =>
                setForm({ ...form, categoryId: categoryId === 'none' ? '' : categoryId })
              }
              disabled={!canManageAccommodations}
            >
              <SelectTrigger id="room-type-category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No category</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Publication status" htmlFor="room-type-status">
            <Select
              value={form.status}
              onValueChange={(status) =>
                setForm({ ...form, status: status as RoomTypeForm['status'] })
              }
              disabled={!canManageAccommodations}
            >
              <SelectTrigger id="room-type-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PUBLISHED">Published</SelectItem>
                <SelectItem value="HIDDEN">Hidden</SelectItem>
                <SelectItem value="DRAFT">Draft</SelectItem>
              </SelectContent>
            </Select>
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
  const [editingOwnRules, setEditingOwnRules] = useState(() => Boolean(room?.rules?.trim()));
  const inheritedRules = roomType?.effectiveRules ?? roomType?.rules ?? null;

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
          <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 sm:col-span-2">
            <div>
              <p className="m-0 text-sm font-semibold">Room active</p>
              <p className="m-0 text-xs text-muted-foreground">
                Inactive rooms are excluded from new availability and bookings.
              </p>
            </div>
            <Switch
              aria-label="Room active"
              checked={form.isActive}
              disabled={!canManageAccommodations}
              onCheckedChange={(isActive) => setForm({ ...form, isActive })}
            />
          </div>
          <div className="sm:col-span-2">
            <FormField
              label="House rules"
              htmlFor="physical-room-rules"
              hint="Shown to guests on the booking page"
            >
              <div className="flex flex-col gap-2">
                {editingOwnRules ? (
                  <Textarea
                    id="physical-room-rules"
                    disabled={!canManageAccommodations}
                    placeholder={inheritedRules ?? undefined}
                    value={form.rules}
                    onChange={(event) => setForm({ ...form, rules: event.target.value })}
                  />
                ) : (
                  <p className="m-0 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                    Using room type rules: {inheritedRules || 'No rules set'}
                  </p>
                )}
                {canManageAccommodations ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="self-start"
                    onClick={() => {
                      if (editingOwnRules) setForm({ ...form, rules: '' });
                      setEditingOwnRules(!editingOwnRules);
                    }}
                  >
                    {editingOwnRules ? 'Use room type rules' : 'Write rules for this room only'}
                  </Button>
                ) : null}
              </div>
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

/** Dialog for managing the property's reusable amenity catalog. */
export function AmenitiesDialog({
  amenities,
  canManageAccommodations,
  open,
  onOpenChange,
  onCreate,
  onDelete,
}: {
  amenities: Amenity[];
  canManageAccommodations: boolean;
  open: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: CreateAmenity;
  onDelete: (amenityId: string) => void | Promise<void>;
}) {
  const [icon, setIcon] = useState<AmenityIcon>('WIFI');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[34rem]">
        <DialogHeader>
          <DialogTitle>Property amenities</DialogTitle>
          <DialogDescription>
            Create amenities in the search box, then assign them to room types or rooms. Remove a
            chip and save to delete an unused property amenity.
          </DialogDescription>
        </DialogHeader>
        {canManageAccommodations ? (
          <FormField label="Icon for a custom amenity" htmlFor="amenity-icon">
            <Select value={icon} onValueChange={(value) => setIcon(value as AmenityIcon)}>
              <SelectTrigger id="amenity-icon" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {amenityIcons.map((item) => {
                  const Icon = amenityIconCatalog[item].icon;
                  return (
                    <SelectItem key={item} value={item}>
                      <span className="flex items-center gap-2">
                        <Icon aria-hidden="true" className="size-4" />
                        {amenityIconLabel(item)}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </FormField>
        ) : null}
        <AmenityMultiSelect
          options={amenitySelectOptions(amenities)}
          value={amenities.map((item) => item.id)}
          onChange={async (ids) => {
            await Promise.all(
              amenities.filter((item) => !ids.includes(item.id)).map((item) => onDelete(item.id)),
            );
          }}
          readOnly={!canManageAccommodations}
          suggestions={suggestedAmenityOptions}
          onCreate={(name, suggestion) =>
            onCreate(name, (suggestion as AmenityIcon) ?? icon).then((item) => item.id)
          }
        />
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
        rules: roomType.rules ?? '',
        maxOccupancy: String(roomType.maxOccupancy),
        status: roomType.status,
        categoryId: roomType.categoryId ?? '',
      }
    : {
        name: '',
        description: '',
        amenitiesIntro: '',
        rules: '',
        maxOccupancy: '2',
        status: 'PUBLISHED',
        categoryId: '',
      };
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
        isActive: room.isActive,
      }
    : {
        name: '',
        title: '',
        roomSize: '',
        rules: '',
        description: '',
        floor: '',
        viewType: '',
        isActive: true,
      };
}
