'use client';

import { Card, Heading, Stack, Text } from '@must/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { DashboardLoadingSkeleton } from '../loading-skeleton';

type Property = { id: string; name: string };
type Room = { id: string; name: string };
type RoomType = { id: string; name: string; description: string | null; maxOccupancy: number };
type RoomTypeImage = { id: string; url: string };
type Amenity = { id: string; name: string };

type RoomManagementData = {
  roomTypes: RoomType[];
  amenities: Amenity[];
  rooms: Record<string, Room[]>;
  images: Record<string, RoomTypeImage[]>;
  roomTypeAmenities: Record<string, Amenity[]>;
};

type RoomTypeForm = {
  name: string;
  description: string;
  maxOccupancy: string;
};

const emptyRoomTypeForm: RoomTypeForm = { name: '', description: '', maxOccupancy: '2' };

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
  const [roomTypeForm, setRoomTypeForm] = useState<RoomTypeForm>(emptyRoomTypeForm);
  const [editingRoomTypeId, setEditingRoomTypeId] = useState<string | null>(null);
  const [roomNames, setRoomNames] = useState<Record<string, string>>({});
  const [editingRoom, setEditingRoom] = useState<{ roomTypeId: string; roomId: string } | null>(
    null,
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
          return {
            roomTypeId: roomType.id,
            rooms: roomResponse.ok ? ((await roomResponse.json()) as Room[]) : [],
            images: imageResponse.ok ? ((await imageResponse.json()) as RoomTypeImage[]) : [],
            roomTypeAmenities: roomTypeAmenityResponse.ok
              ? ((await roomTypeAmenityResponse.json()) as Amenity[])
              : [],
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
      };
    },
    enabled: !!propertyId,
  });

  const roomTypes = roomManagementQuery.data?.roomTypes ?? [];
  const amenities = roomManagementQuery.data?.amenities ?? [];
  const rooms = roomManagementQuery.data?.rooms ?? {};
  const images = roomManagementQuery.data?.images ?? {};
  const roomTypeAmenities = roomManagementQuery.data?.roomTypeAmenities ?? {};

  const saveRoomTypeMutation = useMutation({
    mutationFn: async ({
      roomTypeId,
      name,
      description,
      maxOccupancy,
    }: {
      roomTypeId: string | null;
      name: string;
      description: string;
      maxOccupancy: string;
    }) => {
      const response = await fetch(
        roomTypeId ? `${roomTypesUrl()}/${roomTypeId}` : roomTypesUrl(),
        {
          method: roomTypeId ? 'PATCH' : 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, description, maxOccupancy: Number(maxOccupancy) }),
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
    }: {
      roomTypeId: string;
      roomId: string | null;
      name: string;
    }) => {
      const response = await fetch(
        roomId
          ? `${roomTypesUrl()}/${roomTypeId}/rooms/${roomId}`
          : `${roomTypesUrl()}/${roomTypeId}/rooms`,
        {
          method: roomId ? 'PATCH' : 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        },
      );
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to save room.'));
      return { roomTypeId, isEditing: roomId !== null };
    },
    onSuccess: ({ roomTypeId, isEditing }) => {
      setRoomNames((current) => ({ ...current, [roomTypeId]: '' }));
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

  const uploadImageMutation = useMutation({
    mutationFn: async ({ roomTypeId, file }: { roomTypeId: string; file: File }) => {
      const authorization = await fetch(`${roomTypesUrl()}/${roomTypeId}/images`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contentType: file.type, contentLength: file.size }),
      });
      if (!authorization.ok)
        throw new Error(await errorMessage(authorization, 'Unable to authorize image upload.'));
      const { uploadUrl } = (await authorization.json()) as { uploadUrl: string };
      const upload = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': file.type },
        body: file,
      });
      if (!upload.ok) throw new Error('The image could not be uploaded.');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: roomManagementQueryKey });
      toast.success('Room photo uploaded.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to upload the room photo.'),
  });

  const submitAmenityMutation = useMutation({
    mutationFn: async (name: string) => {
      const response = await fetch(`${propertyUrl()}/amenities`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to create amenity.'));
    },
    onSuccess: () => {
      setAmenityName('');
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

  function submitRoomType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveRoomTypeMutation.mutate({
      roomTypeId: editingRoomTypeId,
      name: roomTypeForm.name,
      description: roomTypeForm.description,
      maxOccupancy: roomTypeForm.maxOccupancy,
    });
  }

  function deleteRoomType(roomTypeId: string) {
    deleteRoomTypeMutation.mutate(roomTypeId);
  }

  function submitRoom(event: FormEvent<HTMLFormElement>, roomTypeId: string) {
    event.preventDefault();
    const roomName = roomNames[roomTypeId]?.trim();
    if (!roomName) return;
    const currentEdit = editingRoom?.roomTypeId === roomTypeId ? editingRoom : null;
    saveRoomMutation.mutate({ roomTypeId, roomId: currentEdit?.roomId ?? null, name: roomName });
  }

  function deleteRoom(roomTypeId: string, roomId: string) {
    deleteRoomMutation.mutate({ roomTypeId, roomId });
  }

  function uploadImage(roomTypeId: string, file: File | undefined) {
    if (!file) return;
    uploadImageMutation.mutate({ roomTypeId, file });
  }

  function submitAmenity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = amenityName.trim();
    if (!name) return;
    submitAmenityMutation.mutate(name);
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

  if (propertiesQuery.isPending || (propertyId && roomManagementQuery.isPending))
    return <DashboardLoadingSkeleton label="Loading rooms…" />;
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
          <Card>
            <Heading level={2}>{editingRoomTypeId ? 'Edit room type' : 'Add room type'}</Heading>
            <form className="must-stack must-stack--md" onSubmit={submitRoomType}>
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
          </Card>
          <Heading level={2}>Configured room types</Heading>
          {roomTypes.length === 0 ? <p>No room types yet.</p> : null}
          {roomTypes.map((roomType) => (
            <Card key={roomType.id}>
              <Heading level={3}>{roomType.name}</Heading>
              <p>
                {roomType.description || 'No description.'} Maximum occupancy:{' '}
                {roomType.maxOccupancy}.
              </p>
              <p>
                Amenities:{' '}
                {roomTypeAmenities[roomType.id]?.map((amenity) => amenity.name).join(', ') ||
                  'None'}
              </p>
              <button
                className="must-button must-button--secondary"
                type="button"
                onClick={() => {
                  setEditingRoomTypeId(roomType.id);
                  setRoomTypeForm({
                    name: roomType.name,
                    description: roomType.description || '',
                    maxOccupancy: String(roomType.maxOccupancy),
                  });
                }}
              >
                Edit room type
              </button>
              <button
                className="must-button must-button--danger"
                type="button"
                onClick={() => deleteRoomType(roomType.id)}
              >
                Delete room type
              </button>
              <div>
                <Heading level={3}>Amenities</Heading>
                {amenities.map((amenity) => (
                  <label className="must-field" key={amenity.id}>
                    <input
                      className="must-input"
                      type="checkbox"
                      checked={roomTypeAmenities[roomType.id]?.some(
                        (assignedAmenity) => assignedAmenity.id === amenity.id,
                      )}
                      onChange={() => toggleRoomTypeAmenity(roomType.id, amenity.id)}
                    />
                    {amenity.name}
                  </label>
                ))}
              </div>
              <div>
                <Heading level={3}>Photos</Heading>
                {images[roomType.id]?.map((image) => (
                  // Images are public marketing content; the URL is issued by the tenant-scoped API.
                  <img key={image.id} src={image.url} alt={`${roomType.name} room`} width="160" />
                ))}
                <label className="must-field">
                  Upload photo
                  <input
                    className="must-input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => uploadImage(roomType.id, event.target.files?.[0])}
                  />
                </label>
              </div>
              <div>
                <Heading level={3}>Physical rooms</Heading>
                <ul>
                  {rooms[roomType.id]?.map((room) => (
                    <li key={room.id}>
                      {room.name}{' '}
                      <button
                        className="must-button must-button--secondary"
                        type="button"
                        onClick={() => {
                          setEditingRoom({ roomTypeId: roomType.id, roomId: room.id });
                          setRoomNames((current) => ({ ...current, [roomType.id]: room.name }));
                        }}
                      >
                        Edit
                      </button>{' '}
                      <button
                        className="must-button must-button--danger"
                        type="button"
                        onClick={() => deleteRoom(roomType.id, room.id)}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
                <form
                  className="must-stack must-stack--sm"
                  onSubmit={(event) => submitRoom(event, roomType.id)}
                >
                  <label className="must-field">
                    {editingRoom?.roomTypeId === roomType.id ? 'Room name' : 'New room name'}
                    <input
                      className="must-input"
                      required
                      value={roomNames[roomType.id] || ''}
                      onChange={(event) =>
                        setRoomNames((current) => ({
                          ...current,
                          [roomType.id]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <button className="must-button must-button--primary">
                    {editingRoom?.roomTypeId === roomType.id ? (
                      'Save room'
                    ) : (
                      <>
                        <Plus aria-hidden="true" size={16} /> Add room
                      </>
                    )}
                  </button>
                </form>
              </div>
            </Card>
          ))}
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
              <button className="must-button must-button--primary">
                <Plus aria-hidden="true" size={16} /> Add amenity
              </button>
            </form>
            <ul>
              {amenities.map((amenity) => (
                <li key={amenity.id}>
                  {amenity.name}{' '}
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
