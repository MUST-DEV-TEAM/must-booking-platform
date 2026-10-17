'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { EmptyPanel, ErrorPanel, ListSkeleton } from '../../../components/ui/state-panel';
import { PageHeader } from '../../../components/ui/page-header';
import { FormField } from '../../../components/ui/form-field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { AmenitiesDialog, RoomEditorDialog, RoomTypeEditorDialog } from './room-management-dialogs';
import { RoomManagementLists } from './room-management-list';
import { RoomTypeDetail } from './room-type-detail';
import { AvailabilityCalendarDialog } from './availability-calendar-dialog';
import type { AvailabilityCalendarTarget } from './availability-calendar-dialog';
import {
  type Amenity,
  type AmenityIcon,
  type Property,
  type Room,
  type RoomForm,
  type RoomManagementData,
  type RoomType,
  type RoomTypeForm,
} from './room-management-types';

/** Property room types and physical rooms, backed by the existing accommodation APIs. */
export function RoomManagement({
  tenantId,
  propertyId: selectedPropertyId,
  canManageAccommodations = false,
  canManagePhotos = false,
  canViewCalendar = false,
  canBlockCalendar = false,
}: {
  tenantId: string;
  propertyId?: string;
  canManageAccommodations?: boolean;
  canManagePhotos?: boolean;
  canViewCalendar?: boolean;
  canBlockCalendar?: boolean;
}) {
  const queryClient = useQueryClient();
  const [propertyId, setPropertyId] = useState('');
  const [roomTypeDialogOpen, setRoomTypeDialogOpen] = useState(false);
  const [editingRoomType, setEditingRoomType] = useState<RoomType | null>(null);
  const [roomDialogOpen, setRoomDialogOpen] = useState(false);
  const [roomTargetType, setRoomTargetType] = useState<RoomType | null>(null);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [amenitiesDialogOpen, setAmenitiesDialogOpen] = useState(false);
  const [roomTypeDetailId, setRoomTypeDetailId] = useState<string | null>(null);
  const [calendarTarget, setCalendarTarget] = useState<AvailabilityCalendarTarget | null>(null);
  const [customizingRoomAmenities, setCustomizingRoomAmenities] = useState<Record<string, boolean>>(
    {},
  );

  const propertiesQuery = useQuery({
    queryKey: ['dashboard', 'properties', tenantId] as const,
    queryFn: async (): Promise<Property[]> => {
      const response = await fetch(`/api/tenants/${tenantId}/properties`, {
        credentials: 'include',
      });
      return response.ok ? ((await response.json()) as Property[]) : [];
    },
  });

  useEffect(() => {
    if (!propertiesQuery.data) return;
    setPropertyId((current) => selectedPropertyId || current || propertiesQuery.data[0]?.id || '');
  }, [propertiesQuery.data, selectedPropertyId]);
  useEffect(() => {
    if (selectedPropertyId) setPropertyId(selectedPropertyId);
  }, [selectedPropertyId]);
  useEffect(() => setRoomTypeDetailId(null), [propertyId]);

  const propertyUrl = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const roomTypesUrl = `${propertyUrl}/room-types`;
  const roomManagementQueryKey = ['dashboard', 'room-management', tenantId, propertyId] as const;
  const roomManagementQuery = useQuery({
    queryKey: roomManagementQueryKey,
    queryFn: async (): Promise<RoomManagementData> => {
      const [roomTypeResponse, amenityResponse] = await Promise.all([
        fetch(roomTypesUrl, { credentials: 'include' }),
        fetch(`${propertyUrl}/amenities`, { credentials: 'include' }),
      ]);
      if (!roomTypeResponse.ok) throw new Error('Unable to load room types.');
      const roomTypes = (await roomTypeResponse.json()) as RoomType[];
      const amenities = amenityResponse.ok ? ((await amenityResponse.json()) as Amenity[]) : [];
      const details = await Promise.all(
        roomTypes.map(async (roomType) => {
          const [roomResponse, imageResponse, roomTypeAmenityResponse] = await Promise.all([
            fetch(`${roomTypesUrl}/${roomType.id}/rooms`, { credentials: 'include' }),
            canManagePhotos
              ? fetch(`${roomTypesUrl}/${roomType.id}/images`, { credentials: 'include' })
              : Promise.resolve(null),
            fetch(`${roomTypesUrl}/${roomType.id}/amenities`, { credentials: 'include' }),
          ]);
          const rooms = roomResponse.ok ? ((await roomResponse.json()) as Room[]) : [];
          const roomAmenities = Object.fromEntries(
            await Promise.all(
              rooms.map(async (room) => {
                const response = await fetch(`${propertyUrl}/rooms/${room.id}/amenities`, {
                  credentials: 'include',
                });
                return [
                  room.id,
                  response.ok ? ((await response.json()) as Amenity[]) : [],
                ] as const;
              }),
            ),
          );
          return {
            roomTypeId: roomType.id,
            rooms,
            images:
              imageResponse?.ok === true
                ? ((await imageResponse.json()) as RoomManagementData['images'][string])
                : [],
            roomTypeAmenities: roomTypeAmenityResponse.ok
              ? ((await roomTypeAmenityResponse.json()) as Amenity[])
              : [],
            roomAmenities,
          };
        }),
      );
      return {
        roomTypes,
        amenities,
        rooms: Object.fromEntries(details.map((detail) => [detail.roomTypeId, detail.rooms])),
        images: Object.fromEntries(details.map((detail) => [detail.roomTypeId, detail.images])),
        roomTypeAmenities: Object.fromEntries(
          details.map((detail) => [detail.roomTypeId, detail.roomTypeAmenities]),
        ),
        roomAmenities: Object.fromEntries(
          details.flatMap((detail) => Object.entries(detail.roomAmenities)),
        ),
      };
    },
    enabled: !!propertyId,
  });

  const data = roomManagementQuery.data ?? {
    roomTypes: [],
    amenities: [],
    rooms: {},
    images: {},
    roomTypeAmenities: {},
    roomAmenities: {},
  };

  function requireAccommodationManagement() {
    if (!canManageAccommodations) throw new Error('You do not hold accommodations.manage.');
  }

  const saveRoomTypeMutation = useMutation({
    mutationFn: async ({ roomType, form }: { roomType: RoomType | null; form: RoomTypeForm }) => {
      requireAccommodationManagement();
      const response = await fetch(roomType ? `${roomTypesUrl}/${roomType.id}` : roomTypesUrl, {
        method: roomType ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          amenitiesIntro: form.amenitiesIntro,
          maxOccupancy: Number(form.maxOccupancy),
        }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to save room type.'));
      return { isEditing: roomType !== null };
    },
    onSuccess: ({ isEditing }) => {
      setRoomTypeDialogOpen(false);
      setEditingRoomType(null);
      void queryClient.invalidateQueries({ queryKey: roomManagementQueryKey });
      toast.success(isEditing ? 'Room type updated.' : 'Room type created.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to save room type.'),
  });

  const duplicateRoomTypeMutation = useMutation({
    mutationFn: async (roomType: RoomType) => {
      requireAccommodationManagement();
      const response = await fetch(roomTypesUrl, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: uniqueRoomTypeCopyName(roomType.name, data.roomTypes),
          description: roomType.description,
          amenitiesIntro: roomType.amenitiesIntro,
          maxOccupancy: roomType.maxOccupancy,
        }),
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to duplicate room type.'));
      const created = (await response.json()) as RoomType;
      const amenityResponse = await fetch(`${roomTypesUrl}/${created.id}/amenities`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          amenityIds: (data.roomTypeAmenities[roomType.id] ?? []).map((amenity) => amenity.id),
        }),
      });
      if (!amenityResponse.ok) {
        await fetch(`${roomTypesUrl}/${created.id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        throw new Error(await errorMessage(amenityResponse, 'Unable to copy room type amenities.'));
      }
      return created;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: roomManagementQueryKey });
      toast.success('Room type duplicated.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to duplicate room type.'),
  });

  const deleteRoomTypeMutation = useMutation({
    mutationFn: async (roomTypeId: string) => {
      requireAccommodationManagement();
      const response = await fetch(`${roomTypesUrl}/${roomTypeId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to delete room type.'));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: roomManagementQueryKey });
      toast.success('Room type deleted.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to delete room type.'),
  });

  const saveRoomMutation = useMutation({
    mutationFn: async ({
      roomType,
      room,
      form,
    }: {
      roomType: RoomType;
      room: Room | null;
      form: RoomForm;
    }) => {
      requireAccommodationManagement();
      const response = await fetch(
        room
          ? `${roomTypesUrl}/${roomType.id}/rooms/${room.id}`
          : `${roomTypesUrl}/${roomType.id}/rooms`,
        {
          method: room ? 'PATCH' : 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: form.name.trim(),
            title: form.title.trim() || null,
            roomSize: form.roomSize.trim() || null,
            rules: form.rules.trim() || null,
            description: form.description.trim() || null,
            floor: form.floor === '' ? null : Number(form.floor),
            viewType: form.viewType.trim() || null,
          }),
        },
      );
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to save room.'));
      return { isEditing: room !== null };
    },
    onSuccess: ({ isEditing }) => {
      setRoomDialogOpen(false);
      setRoomTargetType(null);
      setEditingRoom(null);
      void queryClient.invalidateQueries({ queryKey: roomManagementQueryKey });
      toast.success(isEditing ? 'Room updated.' : 'Room created.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to save room.'),
  });

  const deleteRoomMutation = useMutation({
    mutationFn: async ({ roomType, room }: { roomType: RoomType; room: Room }) => {
      requireAccommodationManagement();
      const response = await fetch(`${roomTypesUrl}/${roomType.id}/rooms/${room.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to delete room.'));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: roomManagementQueryKey });
      toast.success('Room deleted.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to delete room.'),
  });

  const createAmenityMutation = useMutation({
    mutationFn: async ({ name, icon }: { name: string; icon: AmenityIcon }) => {
      requireAccommodationManagement();
      const response = await fetch(`${propertyUrl}/amenities`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, icon }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to create amenity.'));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: roomManagementQueryKey });
      toast.success('Amenity created.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to create amenity.'),
  });

  const deleteAmenityMutation = useMutation({
    mutationFn: async (amenityId: string) => {
      requireAccommodationManagement();
      const response = await fetch(`${propertyUrl}/amenities/${amenityId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to delete amenity.'));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: roomManagementQueryKey });
      toast.success('Amenity deleted.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to delete amenity.'),
  });

  const toggleRoomTypeAmenityMutation = useMutation({
    mutationFn: async ({
      roomTypeId,
      amenityIds,
    }: {
      roomTypeId: string;
      amenityIds: string[];
    }) => {
      requireAccommodationManagement();
      const response = await fetch(`${roomTypesUrl}/${roomTypeId}/amenities`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amenityIds }),
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to update room type amenities.'));
      return (await response.json()) as Amenity[];
    },
    onSuccess: (updated, { roomTypeId }) => {
      queryClient.setQueryData<RoomManagementData>(roomManagementQueryKey, (current) =>
        current
          ? {
              ...current,
              roomTypeAmenities: { ...current.roomTypeAmenities, [roomTypeId]: updated },
            }
          : current,
      );
      toast.success('Room type amenities updated.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to update room type amenities.'),
  });

  const setRoomAmenitiesMutation = useMutation({
    mutationFn: async ({ roomId, amenityIds }: { roomId: string; amenityIds: string[] }) => {
      requireAccommodationManagement();
      const response = await fetch(`${propertyUrl}/rooms/${roomId}/amenities`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amenityIds }),
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to update room amenities.'));
      return { roomId, amenities: (await response.json()) as Amenity[] };
    },
    onSuccess: ({ roomId, amenities }) => {
      queryClient.setQueryData<RoomManagementData>(roomManagementQueryKey, (current) =>
        current
          ? { ...current, roomAmenities: { ...current.roomAmenities, [roomId]: amenities } }
          : current,
      );
      toast.success(
        amenities.length > 0 ? 'Room amenities customized.' : 'Room amenities inherit.',
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to update room amenities.'),
  });

  function addRoomType() {
    if (!canManageAccommodations) return;
    setEditingRoomType(null);
    setRoomTypeDialogOpen(true);
  }
  function editRoomType(roomType: RoomType) {
    if (!canManageAccommodations) return;
    setEditingRoomType(roomType);
    setRoomTypeDialogOpen(true);
  }
  function addRoom(roomType: RoomType) {
    if (!canManageAccommodations) return;
    setRoomTargetType(roomType);
    setEditingRoom(null);
    setRoomDialogOpen(true);
  }
  function editRoom(roomType: RoomType, room: Room) {
    if (!canManageAccommodations) return;
    setRoomTargetType(roomType);
    setEditingRoom(room);
    setRoomDialogOpen(true);
  }
  function toggleTypeAmenity(roomTypeId: string, amenityId: string) {
    if (!canManageAccommodations) return;
    const current = data.roomTypeAmenities[roomTypeId] ?? [];
    const amenityIds = current.some((item) => item.id === amenityId)
      ? current.filter((item) => item.id !== amenityId).map((item) => item.id)
      : [...current.map((item) => item.id), amenityId];
    toggleRoomTypeAmenityMutation.mutate({ roomTypeId, amenityIds });
  }
  function setRoomAmenities(roomId: string, amenityIds: string[]) {
    if (!canManageAccommodations) return;
    setRoomAmenitiesMutation.mutate({ roomId, amenityIds });
  }
  function customizeRoomAmenities(roomId: string, inherited: Amenity[]) {
    if (!canManageAccommodations) return;
    setCustomizingRoomAmenities((current) => ({ ...current, [roomId]: true }));
    setRoomAmenities(
      roomId,
      inherited.map((item) => item.id),
    );
  }
  function toggleRoomAmenity(roomId: string, amenityId: string) {
    if (!canManageAccommodations) return;
    const current = data.roomAmenities[roomId] ?? [];
    const amenityIds = current.some((item) => item.id === amenityId)
      ? current.filter((item) => item.id !== amenityId).map((item) => item.id)
      : [...current.map((item) => item.id), amenityId];
    if (!amenityIds.length)
      setCustomizingRoomAmenities((customizing) => ({ ...customizing, [roomId]: false }));
    setRoomAmenities(roomId, amenityIds);
  }
  function inheritRoomAmenities(roomId: string) {
    if (!canManageAccommodations) return;
    setCustomizingRoomAmenities((current) => ({ ...current, [roomId]: false }));
    setRoomAmenities(roomId, []);
  }

  if (propertiesQuery.isPending || (!!propertyId && roomManagementQuery.isPending))
    return (
      <div className="flex flex-col gap-5">
        <PageHeader
          title="Accommodations"
          description="Room types and physical rooms for this property."
        />
        <ListSkeleton rows={5} />
      </div>
    );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Accommodations"
        description="Manage room types, physical rooms, photos, and amenities for this property."
      />
      {!selectedPropertyId ? (
        propertiesQuery.data?.length ? (
          <FormField label="Property" htmlFor="accommodation-property" className="max-w-sm">
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger id="accommodation-property" className="w-full">
                <SelectValue placeholder="Select a property" />
              </SelectTrigger>
              <SelectContent>
                {propertiesQuery.data.map((property) => (
                  <SelectItem key={property.id} value={property.id}>
                    {property.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        ) : (
          <EmptyPanel
            title="No properties yet"
            description="Create a property before adding room types and physical rooms."
          />
        )
      ) : null}
      {propertyId && roomManagementQuery.isError ? (
        <ErrorPanel
          title="Rooms unavailable"
          description={roomManagementQuery.error.message}
          onRetry={() => void roomManagementQuery.refetch()}
        />
      ) : null}
      {propertyId && !roomManagementQuery.isError && roomManagementQuery.data ? (
        roomTypeDetailId && data.roomTypes.some((roomType) => roomType.id === roomTypeDetailId) ? (
          <RoomTypeDetail
            tenantId={tenantId}
            propertyId={propertyId}
            data={data}
            roomType={data.roomTypes.find((roomType) => roomType.id === roomTypeDetailId)!}
            canManageAccommodations={canManageAccommodations}
            canManagePhotos={canManagePhotos}
            onBack={() => setRoomTypeDetailId(null)}
            onEdit={editRoomType}
            onAddRoom={addRoom}
            onEditRoom={editRoom}
            onToggleAmenity={toggleTypeAmenity}
          />
        ) : (
          <RoomManagementLists
            tenantId={tenantId}
            propertyId={propertyId}
            data={data}
            canManageAccommodations={canManageAccommodations}
            canManagePhotos={canManagePhotos}
            canViewCalendar={canViewCalendar}
            onAddRoomType={addRoomType}
            onEditRoomType={editRoomType}
            onOpenRoomTypeDetail={(roomType) => setRoomTypeDetailId(roomType.id)}
            onDeleteRoomType={(roomType) => {
              if (canManageAccommodations) deleteRoomTypeMutation.mutate(roomType.id);
            }}
            onDuplicateRoomType={(roomType) => {
              if (canManageAccommodations) duplicateRoomTypeMutation.mutate(roomType);
            }}
            onAddRoom={addRoom}
            onEditRoom={editRoom}
            onDeleteRoom={(roomType, room) => {
              if (canManageAccommodations) deleteRoomMutation.mutate({ roomType, room });
            }}
            onOpenCalendar={setCalendarTarget}
            onManageAmenities={() => {
              if (canManageAccommodations) setAmenitiesDialogOpen(true);
            }}
            onToggleRoomTypeAmenity={toggleTypeAmenity}
            onToggleRoomAmenity={toggleRoomAmenity}
            onCustomizeRoomAmenities={customizeRoomAmenities}
            onInheritRoomAmenities={inheritRoomAmenities}
            customizingRoomAmenities={customizingRoomAmenities}
          />
        )
      ) : null}
      <AvailabilityCalendarDialog
        tenantId={tenantId}
        propertyId={propertyId}
        target={calendarTarget}
        open={calendarTarget !== null && canViewCalendar}
        canBlock={canBlockCalendar}
        onOpenChange={(open) => {
          if (!open) setCalendarTarget(null);
        }}
      />
      <RoomTypeEditorDialog
        key={`${editingRoomType?.id ?? 'new'}-${roomTypeDialogOpen ? 'open' : 'closed'}`}
        tenantId={tenantId}
        propertyId={propertyId}
        roomType={editingRoomType}
        images={editingRoomType ? (data.images[editingRoomType.id] ?? []) : []}
        canManageAccommodations={canManageAccommodations}
        canManagePhotos={canManagePhotos}
        open={roomTypeDialogOpen && canManageAccommodations}
        saving={saveRoomTypeMutation.isPending}
        onOpenChange={(open) => {
          setRoomTypeDialogOpen(open);
          if (!open) setEditingRoomType(null);
        }}
        onSave={(form) => saveRoomTypeMutation.mutate({ roomType: editingRoomType, form })}
      />
      <RoomEditorDialog
        key={`${roomTargetType?.id ?? 'none'}-${editingRoom?.id ?? 'new'}-${roomDialogOpen ? 'open' : 'closed'}`}
        roomType={roomTargetType}
        room={editingRoom}
        canManageAccommodations={canManageAccommodations}
        open={roomDialogOpen && canManageAccommodations}
        saving={saveRoomMutation.isPending}
        onOpenChange={(open) => {
          setRoomDialogOpen(open);
          if (!open) {
            setRoomTargetType(null);
            setEditingRoom(null);
          }
        }}
        onSave={(form) =>
          roomTargetType
            ? saveRoomMutation.mutate({ roomType: roomTargetType, room: editingRoom, form })
            : undefined
        }
      />
      <AmenitiesDialog
        amenities={data.amenities}
        canManageAccommodations={canManageAccommodations}
        open={amenitiesDialogOpen && canManageAccommodations}
        saving={createAmenityMutation.isPending}
        onOpenChange={setAmenitiesDialogOpen}
        onCreate={(name, icon) =>
          createAmenityMutation.mutateAsync({ name, icon }).then(() => undefined)
        }
        onDelete={(amenityId) => deleteAmenityMutation.mutate(amenityId)}
      />
    </div>
  );
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return typeof body?.message === 'string' ? body.message : fallback;
}

function uniqueRoomTypeCopyName(name: string, roomTypes: RoomType[]): string {
  const existingNames = new Set(
    roomTypes.map((roomType) => roomType.name.trim().toLocaleLowerCase()),
  );
  let suffix = 1;
  let candidate = `${name} (copy)`;
  while (existingNames.has(candidate.toLocaleLowerCase())) {
    suffix += 1;
    candidate = `${name} (copy ${suffix})`;
  }
  return candidate;
}
