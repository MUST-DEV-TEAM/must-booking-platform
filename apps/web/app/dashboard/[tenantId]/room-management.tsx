'use client';

import { Card, Heading, Stack, StatePanel, Text } from '@must/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image as ImageIcon, Images, LoaderCircle, Plus } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { RoomTypePhotoGallery, type RoomTypeImage } from './room-type-photo-gallery';
import { PropertyImageLibraryDialog } from './property-image-library';
import { RoomTypeMainImageSelector } from './room-type-main-image-selector';
import styles from './room-management.module.css';

type Property = { id: string; name: string };
const amenityIcons = [
  'WIFI',
  'BREAKFAST',
  'POOL',
  'PARKING',
  'AIR_CONDITIONING',
  'BEACH',
  'CABLE_CHANNELS',
  'REFRIGERATOR',
  'FLAT_SCREEN_TV',
  'LINEN',
  'TELEPHONE',
  'DRYER',
  'STREAMING',
  'SAFETY_DEPOSIT_BOX',
] as const;
type AmenityIcon = (typeof amenityIcons)[number];
type Room = {
  id: string;
  name: string;
  title: string | null;
  roomSize: string | null;
  rules: string | null;
  description: string | null;
  floor: number | null;
  viewType: string | null;
};
type RoomType = {
  id: string;
  name: string;
  description: string | null;
  amenitiesIntro: string | null;
  mainImageUrl: string | null;
  galleryImageUrls: string[];
  maxOccupancy: number;
};
type Amenity = { id: string; name: string; icon: AmenityIcon | null };

type RoomManagementData = {
  roomTypes: RoomType[];
  amenities: Amenity[];
  rooms: Record<string, Room[]>;
  images: Record<string, RoomTypeImage[]>;
  roomTypeAmenities: Record<string, Amenity[]>;
  roomAmenities: Record<string, Amenity[]>;
};

type RoomTypeForm = {
  name: string;
  description: string;
  amenitiesIntro: string;
  maxOccupancy: string;
};

type RoomForm = {
  name: string;
  title: string;
  roomSize: string;
  rules: string;
  description: string;
  floor: string;
  viewType: string;
};

const emptyRoomTypeForm: RoomTypeForm = {
  name: '',
  description: '',
  amenitiesIntro: '',
  maxOccupancy: '2',
};
const emptyRoomForm: RoomForm = {
  name: '',
  title: '',
  roomSize: '',
  rules: '',
  description: '',
  floor: '',
  viewType: '',
};

export function RoomManagement({
  tenantId,
  propertyId: selectedPropertyId,
}: {
  tenantId: string;
  propertyId?: string;
}) {
  const queryClient = useQueryClient();
  const [propertyId, setPropertyId] = useState('');
  const [amenityName, setAmenityName] = useState('');
  const [amenityIcon, setAmenityIcon] = useState<AmenityIcon>('WIFI');
  const [roomTypeForm, setRoomTypeForm] = useState<RoomTypeForm>(emptyRoomTypeForm);
  const [editingRoomTypeId, setEditingRoomTypeId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [roomForms, setRoomForms] = useState<Record<string, RoomForm>>({});
  const [editingRoom, setEditingRoom] = useState<{ roomTypeId: string; roomId: string } | null>(
    null,
  );
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

  function roomTypesUrl() {
    return `${propertyUrl()}/room-types`;
  }

  function propertyUrl() {
    return `/api/tenants/${tenantId}/properties/${propertyId}`;
  }

  const roomManagementQueryKey = ['dashboard', 'room-management', tenantId, propertyId] as const;
  const roomManagementQuery = useQuery({
    queryKey: roomManagementQueryKey,
    queryFn: async (): Promise<RoomManagementData> => {
      const [roomTypeResponse, amenityResponse] = await Promise.all([
        fetch(roomTypesUrl(), { credentials: 'include' }),
        fetch(`${propertyUrl()}/amenities`, { credentials: 'include' }),
      ]);
      if (!roomTypeResponse.ok) throw new Error('Unable to load room types.');
      const roomTypes = (await roomTypeResponse.json()) as RoomType[];
      const amenities = amenityResponse.ok ? ((await amenityResponse.json()) as Amenity[]) : [];
      const details = await Promise.all(
        roomTypes.map(async (roomType) => {
          const [roomResponse, imageResponse, roomTypeAmenityResponse] = await Promise.all([
            fetch(`${roomTypesUrl()}/${roomType.id}/rooms`, { credentials: 'include' }),
            fetch(`${roomTypesUrl()}/${roomType.id}/images`, { credentials: 'include' }),
            fetch(`${roomTypesUrl()}/${roomType.id}/amenities`, { credentials: 'include' }),
          ]);
          const rooms = roomResponse.ok ? ((await roomResponse.json()) as Room[]) : [];
          const roomAmenities = Object.fromEntries(
            await Promise.all(
              rooms.map(async (room) => {
                const response = await fetch(`${propertyUrl()}/rooms/${room.id}/amenities`, {
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
            images: imageResponse.ok ? ((await imageResponse.json()) as RoomTypeImage[]) : [],
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

  const roomTypes = roomManagementQuery.data?.roomTypes ?? [];
  const amenities = roomManagementQuery.data?.amenities ?? [];
  const rooms = roomManagementQuery.data?.rooms ?? {};
  const images = roomManagementQuery.data?.images ?? {};
  const roomTypeAmenities = roomManagementQuery.data?.roomTypeAmenities ?? {};
  const roomAmenities = roomManagementQuery.data?.roomAmenities ?? {};

  const saveRoomTypeMutation = useMutation({
    mutationFn: async ({
      roomTypeId,
      name,
      description,
      amenitiesIntro,
      maxOccupancy,
    }: {
      roomTypeId: string | null;
      name: string;
      description: string;
      amenitiesIntro: string;
      maxOccupancy: string;
    }) => {
      const response = await fetch(
        roomTypeId ? `${roomTypesUrl()}/${roomTypeId}` : roomTypesUrl(),
        {
          method: roomTypeId ? 'PATCH' : 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name,
            description,
            amenitiesIntro,
            maxOccupancy: Number(maxOccupancy),
          }),
        },
      );
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to save room type.'));
      return { isEditing: roomTypeId !== null };
    },
    onSuccess: ({ isEditing }) => {
      setRoomTypeForm(emptyRoomTypeForm);
      setEditingRoomTypeId(null);
      void queryClient.invalidateQueries({ queryKey: roomManagementQueryKey });
      toast.success(isEditing ? 'Room type updated.' : 'Room type created.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to save room type.'),
  });

  const deleteRoomTypeMutation = useMutation({
    mutationFn: async (roomTypeId: string) => {
      const response = await fetch(`${roomTypesUrl()}/${roomTypeId}`, {
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
      roomTypeId,
      roomId,
      name,
      title,
      roomSize,
      rules,
      description,
      floor,
      viewType,
    }: {
      roomTypeId: string;
      roomId: string | null;
      name: string;
      title: string;
      roomSize: string;
      rules: string;
      description: string;
      floor: string;
      viewType: string;
    }) => {
      const response = await fetch(
        roomId
          ? `${roomTypesUrl()}/${roomTypeId}/rooms/${roomId}`
          : `${roomTypesUrl()}/${roomTypeId}/rooms`,
        {
          method: roomId ? 'PATCH' : 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name,
            title: title.trim() || null,
            roomSize: roomSize.trim() || null,
            rules: rules.trim() || null,
            description: description.trim() || null,
            floor: floor === '' ? null : Number(floor),
            viewType: viewType.trim() || null,
          }),
        },
      );
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to save room.'));
      return { roomTypeId, isEditing: roomId !== null };
    },
    onSuccess: ({ roomTypeId, isEditing }) => {
      setRoomForms((current) => ({ ...current, [roomTypeId]: emptyRoomForm }));
      setEditingRoom(null);
      void queryClient.invalidateQueries({ queryKey: roomManagementQueryKey });
      toast.success(isEditing ? 'Room updated.' : 'Room created.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to save room.'),
  });

  const deleteRoomMutation = useMutation({
    mutationFn: async ({ roomTypeId, roomId }: { roomTypeId: string; roomId: string }) => {
      const response = await fetch(`${roomTypesUrl()}/${roomTypeId}/rooms/${roomId}`, {
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

  const submitAmenityMutation = useMutation({
    mutationFn: async ({ name, icon }: { name: string; icon: AmenityIcon }) => {
      const response = await fetch(`${propertyUrl()}/amenities`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, icon }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to create amenity.'));
    },
    onSuccess: () => {
      setAmenityName('');
      setAmenityIcon('WIFI');
      void queryClient.invalidateQueries({ queryKey: roomManagementQueryKey });
      toast.success('Amenity created.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to create amenity.'),
  });

  const deleteAmenityMutation = useMutation({
    mutationFn: async (amenityId: string) => {
      const response = await fetch(`${propertyUrl()}/amenities/${amenityId}`, {
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
      const response = await fetch(`${roomTypesUrl()}/${roomTypeId}/amenities`, {
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
      const response = await fetch(`${propertyUrl()}/rooms/${roomId}/amenities`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ amenityIds }),
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to update room amenities.'));
      return { roomId, amenities: (await response.json()) as Amenity[] };
    },
    onSuccess: ({ roomId, amenities: updated }) => {
      queryClient.setQueryData<RoomManagementData>(roomManagementQueryKey, (current) =>
        current
          ? { ...current, roomAmenities: { ...current.roomAmenities, [roomId]: updated } }
          : current,
      );
      toast.success(updated.length > 0 ? 'Room amenities customized.' : 'Room amenities inherit.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to update room amenities.'),
  });

  function submitRoomType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveRoomTypeMutation.mutate({
      roomTypeId: editingRoomTypeId,
      name: roomTypeForm.name,
      description: roomTypeForm.description,
      amenitiesIntro: roomTypeForm.amenitiesIntro,
      maxOccupancy: roomTypeForm.maxOccupancy,
    });
  }

  function deleteRoomType(roomTypeId: string) {
    deleteRoomTypeMutation.mutate(roomTypeId);
  }

  function editRoomType(roomType: RoomType) {
    setEditingRoomTypeId(roomType.id);
    setRoomTypeForm({
      name: roomType.name,
      description: roomType.description || '',
      amenitiesIntro: roomType.amenitiesIntro || '',
      maxOccupancy: String(roomType.maxOccupancy),
    });
    window.requestAnimationFrame(() =>
      document.getElementById('room-type-editor')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      }),
    );
  }

  function submitRoom(event: FormEvent<HTMLFormElement>, roomTypeId: string) {
    event.preventDefault();
    const roomForm = roomForms[roomTypeId] ?? emptyRoomForm;
    const roomName = roomForm.name.trim();
    if (!roomName) return;
    const currentEdit = editingRoom?.roomTypeId === roomTypeId ? editingRoom : null;
    saveRoomMutation.mutate({
      roomTypeId,
      roomId: currentEdit?.roomId ?? null,
      name: roomName,
      title: roomForm.title,
      roomSize: roomForm.roomSize,
      rules: roomForm.rules,
      description: roomForm.description,
      floor: roomForm.floor,
      viewType: roomForm.viewType,
    });
  }

  function deleteRoom(roomTypeId: string, roomId: string) {
    deleteRoomMutation.mutate({ roomTypeId, roomId });
  }

  function submitAmenity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = amenityName.trim();
    if (!name) return;
    submitAmenityMutation.mutate({ name, icon: amenityIcon });
  }

  function deleteAmenity(amenityId: string) {
    deleteAmenityMutation.mutate(amenityId);
  }

  function toggleRoomTypeAmenity(roomTypeId: string, amenityId: string) {
    const current = roomTypeAmenities[roomTypeId] || [];
    const amenityIds = current.some((amenity) => amenity.id === amenityId)
      ? current.filter((amenity) => amenity.id !== amenityId).map((amenity) => amenity.id)
      : [...current.map((amenity) => amenity.id), amenityId];
    toggleRoomTypeAmenityMutation.mutate({ roomTypeId, amenityIds });
  }

  function setRoomAmenities(roomId: string, amenityIds: string[]) {
    setRoomAmenitiesMutation.mutate({ roomId, amenityIds });
  }

  function customizeRoomAmenities(roomId: string, inheritedAmenities: Amenity[]) {
    setCustomizingRoomAmenities((current) => ({ ...current, [roomId]: true }));
    setRoomAmenities(
      roomId,
      inheritedAmenities.map((amenity) => amenity.id),
    );
  }

  function toggleRoomAmenity(roomId: string, amenityId: string) {
    const current = roomAmenities[roomId] || [];
    const amenityIds = current.some((amenity) => amenity.id === amenityId)
      ? current.filter((amenity) => amenity.id !== amenityId).map((amenity) => amenity.id)
      : [...current.map((amenity) => amenity.id), amenityId];
    if (amenityIds.length === 0)
      setCustomizingRoomAmenities((customizing) => ({ ...customizing, [roomId]: false }));
    setRoomAmenities(roomId, amenityIds);
  }

  function inheritRoomAmenities(roomId: string) {
    setCustomizingRoomAmenities((current) => ({ ...current, [roomId]: false }));
    setRoomAmenities(roomId, []);
  }

  if (propertiesQuery.isPending || (propertyId && roomManagementQuery.isPending))
    return (
      <StatePanel
        body={null}
        icon={<LoaderCircle aria-hidden="true" />}
        title="Loading rooms…"
        variant="loading"
      />
    );
  if (propertyId && roomManagementQuery.isError)
    return (
      <section aria-label="Rooms unavailable">
        <Text>{roomManagementQuery.error.message}</Text>
        <button
          className="must-button"
          type="button"
          onClick={() => void roomManagementQuery.refetch()}
        >
          Retry
        </button>
      </section>
    );

  return (
    <Stack gap="lg">
      <header>
        <Text tone="secondary">PROPERTY SETUP</Text>
        <Heading>Rooms and room types</Heading>
        <Text tone="secondary">
          Set up the sellable room types and the physical rooms in each property.
        </Text>
      </header>
      {!selectedPropertyId ? (
        <Card>
          <label className="must-field">
            <span className="must-field__label">Property</span>
            <select
              className="must-input"
              value={propertyId}
              onChange={(event) => setPropertyId(event.target.value)}
            >
              <option value="">Select a property</option>
              {propertiesQuery.data?.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </label>
          {propertiesQuery.data?.length === 0 ? (
            <Text>Create a property before adding rooms.</Text>
          ) : null}
        </Card>
      ) : null}
      {propertyId ? (
        <Stack gap="lg">
          <Card className={styles.editorCard}>
            <Heading level={2}>{editingRoomTypeId ? 'Edit room type' : 'Add room type'}</Heading>
            <form
              className="must-stack must-stack--md"
              id="room-type-editor"
              onSubmit={submitRoomType}
            >
              <label className="must-field">
                Name
                <input
                  className="must-input"
                  required
                  value={roomTypeForm.name}
                  onChange={(event) =>
                    setRoomTypeForm({ ...roomTypeForm, name: event.target.value })
                  }
                />
              </label>
              <label className="must-field">
                Description
                <textarea
                  className="must-input"
                  value={roomTypeForm.description}
                  onChange={(event) =>
                    setRoomTypeForm({ ...roomTypeForm, description: event.target.value })
                  }
                />
              </label>
              <label className="must-field">
                Amenities introduction
                <textarea
                  className="must-input"
                  value={roomTypeForm.amenitiesIntro}
                  onChange={(event) =>
                    setRoomTypeForm({ ...roomTypeForm, amenitiesIntro: event.target.value })
                  }
                />
              </label>
              <label className="must-field">
                Maximum occupancy
                <input
                  className="must-input"
                  required
                  min="1"
                  type="number"
                  value={roomTypeForm.maxOccupancy}
                  onChange={(event) =>
                    setRoomTypeForm({ ...roomTypeForm, maxOccupancy: event.target.value })
                  }
                />
              </label>
              <button className="must-button must-button--primary">
                {editingRoomTypeId ? (
                  'Save room type'
                ) : (
                  <>
                    <Plus aria-hidden="true" size={16} /> Add room type
                  </>
                )}
              </button>
              {editingRoomTypeId ? (
                <button
                  className="must-button must-button--secondary"
                  type="button"
                  onClick={() => {
                    setEditingRoomTypeId(null);
                    setRoomTypeForm(emptyRoomTypeForm);
                  }}
                >
                  Cancel edit
                </button>
              ) : null}
            </form>
            {editingRoomTypeId ? (
              <div className={styles.galleryEditor}>
                <RoomTypeMainImageSelector
                  tenantId={tenantId}
                  propertyId={propertyId}
                  roomTypeId={editingRoomTypeId}
                  roomTypeName={
                    roomTypes.find((roomType) => roomType.id === editingRoomTypeId)?.name ?? 'room'
                  }
                  images={images[editingRoomTypeId] ?? []}
                />
                <RoomTypePhotoGallery
                  tenantId={tenantId}
                  propertyId={propertyId}
                  roomTypeId={editingRoomTypeId}
                  images={images[editingRoomTypeId] ?? []}
                />
              </div>
            ) : null}
          </Card>
          <div className={styles.libraryBar}>
            <div>
              <Heading level={2}>Photo library</Heading>
              <Text tone="secondary">
                Upload property photos once and reuse them across room types.
              </Text>
            </div>
            <button
              className="must-button must-button--secondary"
              type="button"
              onClick={() => setLibraryOpen(true)}
            >
              <Images aria-hidden="true" size={16} /> Manage library
            </button>
          </div>
          {libraryOpen ? (
            <PropertyImageLibraryDialog
              tenantId={tenantId}
              propertyId={propertyId}
              mode="manage"
              title="Photo library"
              onClose={() => setLibraryOpen(false)}
            />
          ) : null}
          <Heading level={2}>Configured room types</Heading>
          {roomTypes.length === 0 ? <p>No room types yet.</p> : null}
          {roomTypes.map((roomType) => {
            const roomImages = images[roomType.id] ?? [];
            const primaryImage = roomImages.find((image) => image.isPrimary) ?? roomImages[0];
            const assignedAmenities = roomTypeAmenities[roomType.id] ?? [];
            const physicalRooms = rooms[roomType.id] ?? [];
            return (
              <Card className={styles.roomTypeCard} key={roomType.id}>
                <div className={styles.roomType}>
                  <div className={styles.summary}>
                    <div className={styles.cover}>
                      {primaryImage ? (
                        <img src={primaryImage.url} alt={`Primary photo of ${roomType.name}`} />
                      ) : (
                        <ImageIcon aria-hidden="true" size={28} />
                      )}
                      {primaryImage ? <span>Primary</span> : null}
                    </div>
                    <div className={styles.summaryText}>
                      <Heading level={3}>{roomType.name}</Heading>
                      <p className={styles.description}>
                        {roomType.description ||
                          'Add a description to help guests choose this room.'}
                      </p>
                      <div className={styles.metadata}>
                        <span>{roomType.maxOccupancy} guests</span>
                        <span>{physicalRooms.length} physical rooms</span>
                        <span>{roomImages.length} photos</span>
                      </div>
                      <p className={styles.amenitySummary}>
                        {assignedAmenities.length
                          ? `${assignedAmenities
                              .slice(0, 3)
                              .map((amenity) => amenity.name)
                              .join(
                                ' · ',
                              )}${assignedAmenities.length > 3 ? ` +${assignedAmenities.length - 3}` : ''}`
                          : 'No amenities selected'}
                      </p>
                    </div>
                    <div className={styles.actions}>
                      <button
                        className="must-button must-button--secondary"
                        type="button"
                        onClick={() => editRoomType(roomType)}
                      >
                        Edit details
                      </button>
                      <button
                        className="must-button must-button--danger"
                        type="button"
                        onClick={() => deleteRoomType(roomType.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <div className={styles.detailSections}>
                    <details className={styles.detailSection}>
                      <summary>
                        <span>Photos</span>
                        <span className={styles.sectionCount}>{roomImages.length}</span>
                      </summary>
                      <div className={styles.sectionContent}>
                        {roomImages.length ? (
                          <div className={styles.photoStrip}>
                            {roomImages.slice(0, 6).map((image) => (
                              <div className={styles.photoPreview} key={image.id}>
                                <img src={image.url} alt={`${roomType.name} room`} />
                                {image.isPrimary ? <span>Primary</span> : null}
                              </div>
                            ))}
                            {roomImages.length > 6 ? (
                              <span className={styles.morePhotos}>+{roomImages.length - 6}</span>
                            ) : null}
                          </div>
                        ) : (
                          <p className={styles.emptyDetail}>No photos added yet.</p>
                        )}
                        <button
                          className="must-button must-button--secondary"
                          type="button"
                          onClick={() => editRoomType(roomType)}
                        >
                          Manage photos
                        </button>
                      </div>
                    </details>

                    <details className={styles.detailSection}>
                      <summary>
                        <span>Amenities</span>
                        <span className={styles.sectionCount}>{assignedAmenities.length}</span>
                      </summary>
                      <div className={`${styles.sectionContent} ${styles.amenityGrid}`}>
                        {amenities.length ? (
                          amenities.map((amenity) => (
                            <label className={styles.amenityOption} key={amenity.id}>
                              <input
                                type="checkbox"
                                checked={assignedAmenities.some((item) => item.id === amenity.id)}
                                onChange={() => toggleRoomTypeAmenity(roomType.id, amenity.id)}
                              />
                              <span>{amenity.name}</span>
                            </label>
                          ))
                        ) : (
                          <p className={styles.emptyDetail}>
                            Create property amenities below first.
                          </p>
                        )}
                      </div>
                    </details>

                    <details className={styles.detailSection}>
                      <summary>
                        <span>Physical rooms</span>
                        <span className={styles.sectionCount}>{physicalRooms.length}</span>
                      </summary>
                      <div className={styles.sectionContent}>
                        {physicalRooms.length ? (
                          <ul className={styles.roomList}>
                            {physicalRooms.map((room) => {
                              const customAmenities = roomAmenities[room.id] ?? [];
                              const usesCustomAmenities =
                                customAmenities.length > 0 ||
                                customizingRoomAmenities[room.id] === true;
                              return (
                                <li className={styles.physicalRoom} key={room.id}>
                                  <div className={styles.physicalRoomHeader}>
                                    <div>
                                      <strong>{room.name}</strong>
                                      <p>
                                        {[
                                          room.viewType,
                                          room.floor !== null ? `Floor ${room.floor}` : null,
                                        ]
                                          .filter(Boolean)
                                          .join(' · ') || 'Room details not set'}
                                      </p>
                                    </div>
                                    <div className={styles.roomActions}>
                                      <button
                                        className="must-button must-button--secondary"
                                        type="button"
                                        onClick={() => {
                                          setEditingRoom({
                                            roomTypeId: roomType.id,
                                            roomId: room.id,
                                          });
                                          setRoomForms((current) => ({
                                            ...current,
                                            [roomType.id]: {
                                              name: room.name,
                                              title: room.title || '',
                                              roomSize: room.roomSize || '',
                                              rules: room.rules || '',
                                              description: room.description || '',
                                              floor: room.floor === null ? '' : String(room.floor),
                                              viewType: room.viewType || '',
                                            },
                                          }));
                                        }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        className="must-button must-button--danger"
                                        type="button"
                                        onClick={() => deleteRoom(roomType.id, room.id)}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  </div>
                                  <div className={styles.roomAmenityRow}>
                                    <span>
                                      {usesCustomAmenities
                                        ? 'Custom amenities'
                                        : 'Inheriting room type amenities'}
                                    </span>
                                    {usesCustomAmenities ? (
                                      <>
                                        <button
                                          className="must-button must-button--secondary"
                                          type="button"
                                          onClick={() => inheritRoomAmenities(room.id)}
                                        >
                                          Inherit room type amenities
                                        </button>
                                        <div className={styles.amenityGrid}>
                                          {amenities.map((amenity) => (
                                            <label
                                              className={styles.amenityOption}
                                              key={amenity.id}
                                            >
                                              <input
                                                type="checkbox"
                                                checked={customAmenities.some(
                                                  (item) => item.id === amenity.id,
                                                )}
                                                onChange={() =>
                                                  toggleRoomAmenity(room.id, amenity.id)
                                                }
                                              />
                                              <span>{amenity.name}</span>
                                            </label>
                                          ))}
                                        </div>
                                      </>
                                    ) : (
                                      <button
                                        className="must-button must-button--secondary"
                                        type="button"
                                        onClick={() =>
                                          customizeRoomAmenities(room.id, assignedAmenities)
                                        }
                                      >
                                        Customize
                                      </button>
                                    )}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        ) : (
                          <p className={styles.emptyDetail}>No physical rooms added yet.</p>
                        )}
                        <form
                          className={`${styles.roomForm} must-stack must-stack--sm`}
                          onSubmit={(event) => submitRoom(event, roomType.id)}
                        >
                          <label className="must-field">
                            {editingRoom?.roomTypeId === roomType.id
                              ? 'Room name'
                              : 'New room name'}
                            <input
                              className="must-input"
                              required
                              value={(roomForms[roomType.id] ?? emptyRoomForm).name}
                              onChange={(event) =>
                                setRoomForms((current) => ({
                                  ...current,
                                  [roomType.id]: {
                                    ...(current[roomType.id] ?? emptyRoomForm),
                                    name: event.target.value,
                                  },
                                }))
                              }
                            />
                          </label>
                          <label className="must-field">
                            Display title
                            <input
                              className="must-input"
                              maxLength={200}
                              placeholder="e.g. Deluxe Sea Suite"
                              value={(roomForms[roomType.id] ?? emptyRoomForm).title}
                              onChange={(event) =>
                                setRoomForms((current) => ({
                                  ...current,
                                  [roomType.id]: {
                                    ...(current[roomType.id] ?? emptyRoomForm),
                                    title: event.target.value,
                                  },
                                }))
                              }
                            />
                          </label>
                          <label className="must-field">
                            Room size
                            <input
                              className="must-input"
                              maxLength={50}
                              placeholder="e.g. 70m²"
                              value={(roomForms[roomType.id] ?? emptyRoomForm).roomSize}
                              onChange={(event) =>
                                setRoomForms((current) => ({
                                  ...current,
                                  [roomType.id]: {
                                    ...(current[roomType.id] ?? emptyRoomForm),
                                    roomSize: event.target.value,
                                  },
                                }))
                              }
                            />
                          </label>
                          <label className="must-field">
                            Room rules override
                            <textarea
                              className="must-input"
                              placeholder="Replaces the property room rules for this room only"
                              value={(roomForms[roomType.id] ?? emptyRoomForm).rules}
                              onChange={(event) =>
                                setRoomForms((current) => ({
                                  ...current,
                                  [roomType.id]: {
                                    ...(current[roomType.id] ?? emptyRoomForm),
                                    rules: event.target.value,
                                  },
                                }))
                              }
                            />
                          </label>
                          <label className="must-field">
                            Room description override
                            <textarea
                              className="must-input"
                              placeholder="Replaces the room type description for this room only"
                              value={(roomForms[roomType.id] ?? emptyRoomForm).description}
                              onChange={(event) =>
                                setRoomForms((current) => ({
                                  ...current,
                                  [roomType.id]: {
                                    ...(current[roomType.id] ?? emptyRoomForm),
                                    description: event.target.value,
                                  },
                                }))
                              }
                            />
                          </label>
                          <label className="must-field">
                            Floor
                            <input
                              className="must-input"
                              type="number"
                              min="-10"
                              max="200"
                              value={(roomForms[roomType.id] ?? emptyRoomForm).floor}
                              onChange={(event) =>
                                setRoomForms((current) => ({
                                  ...current,
                                  [roomType.id]: {
                                    ...(current[roomType.id] ?? emptyRoomForm),
                                    floor: event.target.value,
                                  },
                                }))
                              }
                            />
                          </label>
                          <label className="must-field">
                            View type
                            <input
                              className="must-input"
                              maxLength={100}
                              placeholder="e.g. Sea view"
                              value={(roomForms[roomType.id] ?? emptyRoomForm).viewType}
                              onChange={(event) =>
                                setRoomForms((current) => ({
                                  ...current,
                                  [roomType.id]: {
                                    ...(current[roomType.id] ?? emptyRoomForm),
                                    viewType: event.target.value,
                                  },
                                }))
                              }
                            />
                          </label>
                          <div className={styles.formActions}>
                            <button className="must-button must-button--primary">
                              {editingRoom?.roomTypeId === roomType.id ? (
                                'Save room'
                              ) : (
                                <>
                                  <Plus aria-hidden="true" size={16} /> Add physical room
                                </>
                              )}
                            </button>
                            {editingRoom?.roomTypeId === roomType.id ? (
                              <button
                                className="must-button must-button--secondary"
                                type="button"
                                onClick={() => {
                                  setEditingRoom(null);
                                  setRoomForms((current) => ({
                                    ...current,
                                    [roomType.id]: emptyRoomForm,
                                  }));
                                }}
                              >
                                Cancel
                              </button>
                            ) : null}
                          </div>
                        </form>
                      </div>
                    </details>
                  </div>
                </div>
              </Card>
            );
          })}
          <Card>
            <Heading level={2}>Amenities</Heading>
            <p>Create property amenities, then tag the room types above.</p>
            <form className="must-stack must-stack--sm" onSubmit={submitAmenity}>
              <label className="must-field">
                Amenity name
                <input
                  className="must-input"
                  required
                  maxLength={100}
                  value={amenityName}
                  onChange={(event) => setAmenityName(event.target.value)}
                />
              </label>
              <label className="must-field">
                Icon
                <select
                  className="must-input"
                  value={amenityIcon}
                  onChange={(event) => setAmenityIcon(event.target.value as AmenityIcon)}
                >
                  {amenityIcons.map((icon) => (
                    <option key={icon} value={icon}>
                      {amenityIconLabel(icon)}
                    </option>
                  ))}
                </select>
              </label>
              <button className="must-button must-button--primary">
                <Plus aria-hidden="true" size={16} /> Add amenity
              </button>
            </form>
            <ul>
              {amenities.map((amenity) => (
                <li key={amenity.id}>
                  {amenity.name} ({amenity.icon ? amenityIconLabel(amenity.icon) : 'No icon'}){' '}
                  <button
                    className="must-button must-button--danger"
                    type="button"
                    onClick={() => deleteAmenity(amenity.id)}
                  >
                    Delete amenity
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        </Stack>
      ) : null}
    </Stack>
  );
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return typeof body?.message === 'string' ? body.message : fallback;
}

function amenityIconLabel(icon: AmenityIcon): string {
  return icon.toLocaleLowerCase().replaceAll('_', ' ');
}
