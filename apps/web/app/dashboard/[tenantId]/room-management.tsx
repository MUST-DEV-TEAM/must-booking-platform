'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { EmptyPanel, ErrorPanel, ListSkeleton } from '../../../components/ui/state-panel';
import { PageHeader } from '../../../components/ui/page-header';
import { TabBar } from '../../../components/ui/tab-bar';
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
import { RoomCategoriesPanel } from './room-categories-panel';
import { AccommodationOverview } from './accommodation-overview';
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
  type RoomCategory,
} from './room-management-types';

/** Property room types and physical rooms, backed by the existing accommodation APIs. */
export function RoomManagement({
  tenantId,
  propertyId: selectedPropertyId,
  canManageAccommodations = false,
  canManagePhotos = false,
  canViewCalendar = false,
  canBlockCalendar = false,
  canManageRates = false,
  canManageInventorySource = false,
  onNavigateSection,
}: {
  tenantId: string;
  propertyId?: string;
  canManageAccommodations?: boolean;
  canManagePhotos?: boolean;
  canViewCalendar?: boolean;
  canBlockCalendar?: boolean;
  canManageRates?: boolean;
  canManageInventorySource?: boolean;
  onNavigateSection?: (section: string) => void;
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
  const [accommodationTab, setAccommodationTab] = useState<'lists' | 'categories'>('lists');
  const [roomTypeDetailTab, setRoomTypeDetailTab] = useState<'overview' | 'photos'>('overview');

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
      const [roomTypeResponse, amenityResponse, categoryResponse, activityResponse] =
        await Promise.all([
          fetch(roomTypesUrl, { credentials: 'include' }),
          fetch(`${propertyUrl}/amenities`, { credentials: 'include' }),
          fetch(`${propertyUrl}/room-categories`, { credentials: 'include' }),
          canManageAccommodations
            ? fetch(`${propertyUrl}/audit-logs`, { credentials: 'include' })
            : Promise.resolve(null),
        ]);
      if (!roomTypeResponse.ok) throw new Error('Unable to load room types.');
      const roomTypes = (await roomTypeResponse.json()) as RoomType[];
      const amenities = amenityResponse.ok ? ((await amenityResponse.json()) as Amenity[]) : [];
      const categories = categoryResponse.ok
        ? ((await categoryResponse.json()) as RoomCategory[])
        : [];
      const activity =
        activityResponse?.ok === true
          ? ((await activityResponse.json()) as RoomManagementData['activity'])
          : [];
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
        categories,
        activity,
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
    categories: [],
    activity: [],
    amenities: [],
    rooms: {},
    images: {},
    roomTypeAmenities: {},
    roomAmenities: {},
  };

  function requireAccommodationManagement() {
    if (!canManageAccommodations) throw new Error('You do not hold accommodations.manage.');
  }

  const createCategoryMutation = useMutation({
    mutationFn: async (input: { name: string; description: string }) => {
      requireAccommodationManagement();
      const response = await fetch(`${propertyUrl}/room-categories`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to add category.'));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: roomManagementQueryKey });
      toast.success('Category added.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to add category.'),
  });

  const updateCategoryMutation = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: Partial<RoomCategory> }) => {
      requireAccommodationManagement();
      const response = await fetch(`${propertyUrl}/room-categories/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      });
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to update category.'));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: roomManagementQueryKey });
      toast.success('Category updated.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to update category.'),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (category: RoomCategory) => {
      requireAccommodationManagement();
      const response = await fetch(`${propertyUrl}/room-categories/${category.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to delete category.'));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: roomManagementQueryKey });
      toast.success('Category deleted. Room types are now uncategorized.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to delete category.'),
  });

  const reorderCategoriesMutation = useMutation({
    mutationFn: async (categoryIds: string[]) => {
      requireAccommodationManagement();
      const response = await fetch(`${propertyUrl}/room-categories/order`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categoryIds }),
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to reorder categories.'));
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: roomManagementQueryKey }),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to reorder categories.'),
  });

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
          rules: form.rules.trim() || null,
          maxOccupancy: Number(form.maxOccupancy),
          status: form.status,
          categoryId: form.categoryId || null,
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
          rules: roomType.rules ?? null,
          maxOccupancy: roomType.maxOccupancy,
          categoryId: roomType.categoryId,
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
            isActive: form.isActive,
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

  const setRoomTypeStatusMutation = useMutation({
    mutationFn: async ({
      roomTypes,
      status,
    }: {
      roomTypes: RoomType[];
      status: RoomType['status'];
    }) => {
      requireAccommodationManagement();
      const responses = await Promise.all(
        roomTypes.map((roomType) =>
          fetch(`${roomTypesUrl}/${roomType.id}`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              name: roomType.name,
              description: roomType.description,
              amenitiesIntro: roomType.amenitiesIntro,
              maxOccupancy: roomType.maxOccupancy,
              status,
            }),
          }),
        ),
      );
      const failed = responses.find((response) => !response.ok);
      if (failed)
        throw new Error(await errorMessage(failed, 'Unable to update publication status.'));
    },
    onSuccess: (_, { status, roomTypes }) => {
      void queryClient.invalidateQueries({ queryKey: roomManagementQueryKey });
      toast.success(
        `${roomTypes.length} room type${roomTypes.length === 1 ? '' : 's'} set to ${status.toLowerCase()}.`,
      );
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: roomManagementQueryKey });
      toast.error(error instanceof Error ? error.message : 'Unable to update publication status.');
    },
  });

  const toggleRoomActiveMutation = useMutation({
    mutationFn: async ({
      roomType,
      room,
      isActive,
    }: {
      roomType: RoomType;
      room: Room;
      isActive: boolean;
    }) => {
      requireAccommodationManagement();
      const response = await fetch(`${roomTypesUrl}/${roomType.id}/rooms/${room.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: room.name,
          title: room.title,
          roomSize: room.roomSize,
          rules: room.rules,
          description: room.description,
          floor: room.floor,
          viewType: room.viewType,
          isActive,
        }),
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to update room status.'));
      return isActive;
    },
    onSuccess: (isActive) => {
      void queryClient.invalidateQueries({ queryKey: roomManagementQueryKey });
      toast.success(isActive ? 'Room activated.' : 'Room deactivated.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to update room status.'),
  });

  const createAmenityMutation = useMutation({
    mutationFn: async ({ name, icon }: { name: string; icon: AmenityIcon | null }) => {
      requireAccommodationManagement();
      const response = await fetch(`${propertyUrl}/amenities`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, icon }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to create amenity.'));
      return (await response.json()) as Amenity;
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
  function setTypeAmenities(roomTypeId: string, amenityIds: string[]) {
    if (!canManageAccommodations) return;
    return toggleRoomTypeAmenityMutation
      .mutateAsync({ roomTypeId, amenityIds })
      .then(() => undefined);
  }

  function fixReadiness(
    roomType: RoomType,
    key:
      | 'basicInfo'
      | 'occupancy'
      | 'rateRule'
      | 'rooms'
      | 'availabilitySource'
      | 'photos'
      | 'inventoryConflict',
  ) {
    if (key === 'basicInfo' || key === 'occupancy') {
      editRoomType(roomType);
    } else if (key === 'rooms') {
      addRoom(roomType);
    } else if (key === 'photos') {
      setRoomTypeDetailTab('photos');
      setRoomTypeDetailId(roomType.id);
    } else if (key === 'rateRule') {
      onNavigateSection?.('rates-pricing');
    } else {
      onNavigateSection?.('hotels');
    }
  }
  async function setRoomAmenities(roomId: string, amenityIds: string[]) {
    if (!canManageAccommodations) return;
    await setRoomAmenitiesMutation.mutateAsync({ roomId, amenityIds });
    if (!amenityIds.length)
      setCustomizingRoomAmenities((current) => ({ ...current, [roomId]: false }));
  }
  function customizeRoomAmenities(roomId: string, inherited: Amenity[]) {
    if (!canManageAccommodations) return;
    setCustomizingRoomAmenities((current) => ({ ...current, [roomId]: true }));
    void setRoomAmenities(
      roomId,
      inherited.map((item) => item.id),
    ).catch(() => setCustomizingRoomAmenities((current) => ({ ...current, [roomId]: false })));
  }
  function inheritRoomAmenities(roomId: string) {
    if (!canManageAccommodations) return;
    setCustomizingRoomAmenities((current) => ({ ...current, [roomId]: false }));
    void setRoomAmenities(roomId, []).catch(() =>
      setCustomizingRoomAmenities((current) => ({ ...current, [roomId]: true })),
    );
  }

  if (propertiesQuery.isPending || (!!propertyId && roomManagementQuery.isPending))
    return (
      <div className="flex min-w-0 flex-col gap-5">
        <PageHeader
          title="Accommodations"
          description="Room types and physical rooms for this property."
        />
        <ListSkeleton rows={5} />
      </div>
    );

  return (
    <div className="flex min-w-0 flex-col gap-5">
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
            initialTab={roomTypeDetailTab}
            onBack={() => setRoomTypeDetailId(null)}
            onEdit={editRoomType}
            onAddRoom={addRoom}
            onEditRoom={editRoom}
            onSetAmenities={setTypeAmenities}
            onCreateAmenity={(name, icon) => createAmenityMutation.mutateAsync({ name, icon })}
          />
        ) : (
          <>
            <AccommodationOverview
              roomTypes={data.roomTypes}
              activity={data.activity}
              canFix={(key) =>
                key === 'photos'
                  ? canManagePhotos
                  : key === 'rateRule'
                    ? canManageRates
                    : key === 'availabilitySource' || key === 'inventoryConflict'
                      ? canManageInventorySource
                      : canManageAccommodations
              }
              onFix={fixReadiness}
            />
            <TabBar
              label="Accommodation views"
              current={accommodationTab}
              onSelect={(tab) => setAccommodationTab(tab as typeof accommodationTab)}
              tabs={[
                { id: 'lists', label: 'Room types and rooms' },
                { id: 'categories', label: 'Categories', count: data.categories.length },
              ]}
            />
            {accommodationTab === 'categories' ? (
              <RoomCategoriesPanel
                categories={data.categories}
                canManage={canManageAccommodations}
                saving={
                  createCategoryMutation.isPending ||
                  updateCategoryMutation.isPending ||
                  deleteCategoryMutation.isPending ||
                  reorderCategoriesMutation.isPending
                }
                onCreate={(value) => createCategoryMutation.mutate(value)}
                onUpdate={(id, value) => updateCategoryMutation.mutate({ id, value })}
                onDelete={(category) => deleteCategoryMutation.mutate(category)}
                onReorder={(categoryIds) => reorderCategoriesMutation.mutate(categoryIds)}
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
                onOpenRoomTypeDetail={(roomType) => {
                  setRoomTypeDetailTab('overview');
                  setRoomTypeDetailId(roomType.id);
                }}
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
                onToggleRoomActive={(roomType, room, isActive) => {
                  if (canManageAccommodations)
                    toggleRoomActiveMutation.mutate({ roomType, room, isActive });
                }}
                onSetRoomTypeStatus={(roomTypes, status) => {
                  if (canManageAccommodations)
                    setRoomTypeStatusMutation.mutate({ roomTypes, status });
                }}
                onOpenCalendar={setCalendarTarget}
                onManageAmenities={() => {
                  if (canManageAccommodations) setAmenitiesDialogOpen(true);
                }}
                onSetRoomTypeAmenities={setTypeAmenities}
                onCreateAmenity={(name, icon) => createAmenityMutation.mutateAsync({ name, icon })}
                onSetRoomAmenities={setRoomAmenities}
                onCustomizeRoomAmenities={customizeRoomAmenities}
                onInheritRoomAmenities={inheritRoomAmenities}
                onImportComplete={() => {
                  void queryClient.invalidateQueries({ queryKey: roomManagementQueryKey });
                  toast.success('Accommodation CSV imported.');
                }}
                customizingRoomAmenities={customizingRoomAmenities}
              />
            )}
          </>
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
        categories={data.categories}
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
        onCreate={(name, icon) => createAmenityMutation.mutateAsync({ name, icon })}
        onDelete={(amenityId) => deleteAmenityMutation.mutateAsync(amenityId)}
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
