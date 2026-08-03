'use client';

import { Card, Heading, Stack, Text } from '@must/ui';
import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { DashboardLoadingSkeleton } from '../loading-skeleton';

type Property = { id: string; name: string };
type Room = { id: string; name: string };
type RoomType = { id: string; name: string; description: string | null; maxOccupancy: number };
type RoomTypeImage = { id: string; url: string };
type Amenity = { id: string; name: string };

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
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [propertyId, setPropertyId] = useState('');
  const [roomTypes, setRoomTypes] = useState<RoomType[] | null>(null);
  const [rooms, setRooms] = useState<Record<string, Room[]>>({});
  const [images, setImages] = useState<Record<string, RoomTypeImage[]>>({});
  const [amenities, setAmenities] = useState<Amenity[]>([]);
  const [roomTypeAmenities, setRoomTypeAmenities] = useState<Record<string, Amenity[]>>({});
  const [amenityName, setAmenityName] = useState('');
  const [roomTypeForm, setRoomTypeForm] = useState<RoomTypeForm>(emptyRoomTypeForm);
  const [editingRoomTypeId, setEditingRoomTypeId] = useState<string | null>(null);
  const [roomNames, setRoomNames] = useState<Record<string, string>>({});
  const [editingRoom, setEditingRoom] = useState<{ roomTypeId: string; roomId: string } | null>(
    null,
  );

  useEffect(() => {
    void fetch(`/api/tenants/${tenantId}/properties`, { credentials: 'include' })
      .then(async (response) => (response.ok ? ((await response.json()) as Property[]) : []))
      .then((items) => {
        setProperties(items);
        setPropertyId((current) => selectedPropertyId || current || items[0]?.id || '');
      })
      .catch(() => setProperties([]));
  }, [selectedPropertyId, tenantId]);

  useEffect(() => {
    if (selectedPropertyId) setPropertyId(selectedPropertyId);
  }, [selectedPropertyId]);

  useEffect(() => {
    if (!propertyId) {
      setRoomTypes(null);
      return;
    }
    void loadRoomTypes();
  }, [propertyId]);

  async function loadRoomTypes() {
    const [response, amenityResponse] = await Promise.all([
      fetch(roomTypesUrl(), { credentials: 'include' }),
      fetch(`${propertyUrl()}/amenities`, { credentials: 'include' }),
    ]);
    if (!response.ok) {
      setRoomTypes([]);
      toast.error('Unable to load room types.');
      return;
    }
    const items = (await response.json()) as RoomType[];
    setRoomTypes(items);
    if (amenityResponse.ok) setAmenities((await amenityResponse.json()) as Amenity[]);
    await Promise.all(items.map((roomType) => loadRoomDetails(roomType.id)));
  }

  async function loadRoomDetails(roomTypeId: string) {
    const [roomResponse, imageResponse, amenityResponse] = await Promise.all([
      fetch(`${roomTypesUrl()}/${roomTypeId}/rooms`, { credentials: 'include' }),
      fetch(`${roomTypesUrl()}/${roomTypeId}/images`, { credentials: 'include' }),
      fetch(`${roomTypesUrl()}/${roomTypeId}/amenities`, { credentials: 'include' }),
    ]);
    if (roomResponse.ok) {
      const items = (await roomResponse.json()) as Room[];
      setRooms((current) => ({ ...current, [roomTypeId]: items }));
    }
    if (imageResponse.ok) {
      const items = (await imageResponse.json()) as RoomTypeImage[];
      setImages((current) => ({ ...current, [roomTypeId]: items }));
    }
    if (amenityResponse.ok) {
      const items = (await amenityResponse.json()) as Amenity[];
      setRoomTypeAmenities((current) => ({ ...current, [roomTypeId]: items }));
    }
  }

  async function submitRoomType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const isEditing = editingRoomTypeId !== null;
    const response = await fetch(
      editingRoomTypeId ? `${roomTypesUrl()}/${editingRoomTypeId}` : roomTypesUrl(),
      {
        method: editingRoomTypeId ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: roomTypeForm.name,
          description: roomTypeForm.description,
          maxOccupancy: Number(roomTypeForm.maxOccupancy),
        }),
      },
    );
    if (!response.ok) {
      toast.error(await errorMessage(response, 'Unable to save room type.'));
      return;
    }
    setRoomTypeForm(emptyRoomTypeForm);
    setEditingRoomTypeId(null);
    await loadRoomTypes();
    toast.success(isEditing ? 'Room type updated.' : 'Room type created.');
  }

  async function deleteRoomType(roomTypeId: string) {
    const response = await fetch(`${roomTypesUrl()}/${roomTypeId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) {
      toast.error(await errorMessage(response, 'Unable to delete room type.'));
      return;
    }
    await loadRoomTypes();
    toast.success('Room type deleted.');
  }

  async function submitRoom(event: FormEvent<HTMLFormElement>, roomTypeId: string) {
    event.preventDefault();
    const roomName = roomNames[roomTypeId]?.trim();
    if (!roomName) return;
    const currentEdit = editingRoom?.roomTypeId === roomTypeId ? editingRoom : null;
    const response = await fetch(
      currentEdit
        ? `${roomTypesUrl()}/${roomTypeId}/rooms/${currentEdit.roomId}`
        : `${roomTypesUrl()}/${roomTypeId}/rooms`,
      {
        method: currentEdit ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: roomName }),
      },
    );
    if (!response.ok) {
      toast.error(await errorMessage(response, 'Unable to save room.'));
      return;
    }
    setRoomNames((current) => ({ ...current, [roomTypeId]: '' }));
    setEditingRoom(null);
    await loadRoomDetails(roomTypeId);
    toast.success(currentEdit ? 'Room updated.' : 'Room created.');
  }

  async function deleteRoom(roomTypeId: string, roomId: string) {
    const response = await fetch(`${roomTypesUrl()}/${roomTypeId}/rooms/${roomId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) {
      toast.error(await errorMessage(response, 'Unable to delete room.'));
      return;
    }
    await loadRoomDetails(roomTypeId);
    toast.success('Room deleted.');
  }

  async function uploadImage(roomTypeId: string, file: File | undefined) {
    if (!file) return;
    const authorization = await fetch(`${roomTypesUrl()}/${roomTypeId}/images`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: file.type, contentLength: file.size }),
    });
    if (!authorization.ok) {
      toast.error(await errorMessage(authorization, 'Unable to authorize image upload.'));
      return;
    }
    const { uploadUrl } = (await authorization.json()) as { uploadUrl: string };
    const upload = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file,
    });
    if (!upload.ok) {
      toast.error('The image could not be uploaded.');
      return;
    }
    await loadRoomDetails(roomTypeId);
    toast.success('Room photo uploaded.');
  }

  async function submitAmenity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = amenityName.trim();
    if (!name) return;
    const response = await fetch(`${propertyUrl()}/amenities`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      toast.error(await errorMessage(response, 'Unable to create amenity.'));
      return;
    }
    setAmenityName('');
    await loadRoomTypes();
    toast.success('Amenity created.');
  }

  async function deleteAmenity(amenityId: string) {
    const response = await fetch(`${propertyUrl()}/amenities/${amenityId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) {
      toast.error(await errorMessage(response, 'Unable to delete amenity.'));
      return;
    }
    await loadRoomTypes();
    toast.success('Amenity deleted.');
  }

  async function toggleRoomTypeAmenity(roomTypeId: string, amenityId: string) {
    const current = roomTypeAmenities[roomTypeId] || [];
    const amenityIds = current.some((amenity) => amenity.id === amenityId)
      ? current.filter((amenity) => amenity.id !== amenityId).map((amenity) => amenity.id)
      : [...current.map((amenity) => amenity.id), amenityId];
    const response = await fetch(`${roomTypesUrl()}/${roomTypeId}/amenities`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amenityIds }),
    });
    if (!response.ok) {
      toast.error(await errorMessage(response, 'Unable to update room type amenities.'));
      return;
    }
    const updated = (await response.json()) as Amenity[];
    setRoomTypeAmenities((currentAmenities) => ({
      ...currentAmenities,
      [roomTypeId]: updated,
    }));
    toast.success('Room type amenities updated.');
  }

  function roomTypesUrl() {
    return `${propertyUrl()}/room-types`;
  }

  function propertyUrl() {
    return `/api/tenants/${tenantId}/properties/${propertyId}`;
  }

  if (properties === null || (propertyId && roomTypes === null))
    return <DashboardLoadingSkeleton label="Loading rooms…" />;

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
              {properties?.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
          </label>
          {properties?.length === 0 ? <Text>Create a property before adding rooms.</Text> : null}
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
                {editingRoomTypeId ? 'Save room type' : 'Add room type'}
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
          {roomTypes === null ? <p>Loading room types…</p> : null}
          {roomTypes?.length === 0 ? <p>No room types yet.</p> : null}
          {roomTypes?.map((roomType) => (
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
                onClick={() => void deleteRoomType(roomType.id)}
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
                      onChange={() => void toggleRoomTypeAmenity(roomType.id, amenity.id)}
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
                    onChange={(event) => void uploadImage(roomType.id, event.target.files?.[0])}
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
                        onClick={() => void deleteRoom(roomType.id, room.id)}
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
                <form
                  className="must-stack must-stack--sm"
                  onSubmit={(event) => void submitRoom(event, roomType.id)}
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
                    {editingRoom?.roomTypeId === roomType.id ? 'Save room' : 'Add room'}
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
              <button className="must-button must-button--primary">Add amenity</button>
            </form>
            <ul>
              {amenities.map((amenity) => (
                <li key={amenity.id}>
                  {amenity.name}{' '}
                  <button
                    className="must-button must-button--danger"
                    type="button"
                    onClick={() => void deleteAmenity(amenity.id)}
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
