'use client';

import { FormEvent, useEffect, useState } from 'react';

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

export function RoomManagement({ tenantId }: { tenantId: string }) {
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
  const [message, setMessage] = useState('');

  useEffect(() => {
    void fetch(`/api/tenants/${tenantId}/properties`, { credentials: 'include' })
      .then(async (response) => (response.ok ? ((await response.json()) as Property[]) : []))
      .then((items) => {
        setProperties(items);
        setPropertyId((current) => current || items[0]?.id || '');
      })
      .catch(() => setProperties([]));
  }, [tenantId]);

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
      setMessage('Unable to load room types.');
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
    setMessage('');
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
      setMessage(await errorMessage(response, 'Unable to save room type.'));
      return;
    }
    setRoomTypeForm(emptyRoomTypeForm);
    setEditingRoomTypeId(null);
    await loadRoomTypes();
  }

  async function deleteRoomType(roomTypeId: string) {
    setMessage('');
    const response = await fetch(`${roomTypesUrl()}/${roomTypeId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) {
      setMessage(await errorMessage(response, 'Unable to delete room type.'));
      return;
    }
    await loadRoomTypes();
  }

  async function submitRoom(event: FormEvent<HTMLFormElement>, roomTypeId: string) {
    event.preventDefault();
    setMessage('');
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
      setMessage(await errorMessage(response, 'Unable to save room.'));
      return;
    }
    setRoomNames((current) => ({ ...current, [roomTypeId]: '' }));
    setEditingRoom(null);
    await loadRoomDetails(roomTypeId);
  }

  async function deleteRoom(roomTypeId: string, roomId: string) {
    setMessage('');
    const response = await fetch(`${roomTypesUrl()}/${roomTypeId}/rooms/${roomId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) {
      setMessage(await errorMessage(response, 'Unable to delete room.'));
      return;
    }
    await loadRoomDetails(roomTypeId);
  }

  async function uploadImage(roomTypeId: string, file: File | undefined) {
    if (!file) return;
    setMessage('');
    const authorization = await fetch(`${roomTypesUrl()}/${roomTypeId}/images`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentType: file.type, contentLength: file.size }),
    });
    if (!authorization.ok) {
      setMessage(await errorMessage(authorization, 'Unable to authorize image upload.'));
      return;
    }
    const { uploadUrl } = (await authorization.json()) as { uploadUrl: string };
    const upload = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'content-type': file.type },
      body: file,
    });
    if (!upload.ok) {
      setMessage('The image could not be uploaded.');
      return;
    }
    await loadRoomDetails(roomTypeId);
  }

  async function submitAmenity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = amenityName.trim();
    if (!name) return;
    setMessage('');
    const response = await fetch(`${propertyUrl()}/amenities`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!response.ok) {
      setMessage(await errorMessage(response, 'Unable to create amenity.'));
      return;
    }
    setAmenityName('');
    await loadRoomTypes();
  }

  async function deleteAmenity(amenityId: string) {
    setMessage('');
    const response = await fetch(`${propertyUrl()}/amenities/${amenityId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) {
      setMessage(await errorMessage(response, 'Unable to delete amenity.'));
      return;
    }
    await loadRoomTypes();
  }

  async function toggleRoomTypeAmenity(roomTypeId: string, amenityId: string) {
    const current = roomTypeAmenities[roomTypeId] || [];
    const amenityIds = current.some((amenity) => amenity.id === amenityId)
      ? current.filter((amenity) => amenity.id !== amenityId).map((amenity) => amenity.id)
      : [...current.map((amenity) => amenity.id), amenityId];
    setMessage('');
    const response = await fetch(`${roomTypesUrl()}/${roomTypeId}/amenities`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amenityIds }),
    });
    if (!response.ok) {
      setMessage(await errorMessage(response, 'Unable to update room type amenities.'));
      return;
    }
    const updated = (await response.json()) as Amenity[];
    setRoomTypeAmenities((currentAmenities) => ({
      ...currentAmenities,
      [roomTypeId]: updated,
    }));
  }

  function roomTypesUrl() {
    return `${propertyUrl()}/room-types`;
  }

  function propertyUrl() {
    return `/api/tenants/${tenantId}/properties/${propertyId}`;
  }

  return (
    <section>
      <h2>Rooms and room types</h2>
      <p>Set up the sellable room types and the physical rooms in each property.</p>
      <label>
        Property
        <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>
          <option value="">Select a property</option>
          {properties?.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
      </label>
      {properties?.length === 0 ? <p>Create a property before adding rooms.</p> : null}
      {propertyId ? (
        <>
          <h3>{editingRoomTypeId ? 'Edit room type' : 'Add room type'}</h3>
          <form onSubmit={submitRoomType}>
            <label>
              Name
              <input
                required
                value={roomTypeForm.name}
                onChange={(event) => setRoomTypeForm({ ...roomTypeForm, name: event.target.value })}
              />
            </label>
            <label>
              Description
              <textarea
                value={roomTypeForm.description}
                onChange={(event) =>
                  setRoomTypeForm({ ...roomTypeForm, description: event.target.value })
                }
              />
            </label>
            <label>
              Maximum occupancy
              <input
                required
                min="1"
                type="number"
                value={roomTypeForm.maxOccupancy}
                onChange={(event) =>
                  setRoomTypeForm({ ...roomTypeForm, maxOccupancy: event.target.value })
                }
              />
            </label>
            <button>{editingRoomTypeId ? 'Save room type' : 'Add room type'}</button>
            {editingRoomTypeId ? (
              <button
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
          <h3>Configured room types</h3>
          {roomTypes === null ? <p>Loading room types…</p> : null}
          {roomTypes?.length === 0 ? <p>No room types yet.</p> : null}
          {roomTypes?.map((roomType) => (
            <article key={roomType.id}>
              <h4>{roomType.name}</h4>
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
              <button type="button" onClick={() => void deleteRoomType(roomType.id)}>
                Delete room type
              </button>
              <div>
                <h5>Amenities</h5>
                {amenities.map((amenity) => (
                  <label key={amenity.id}>
                    <input
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
                <h5>Photos</h5>
                {images[roomType.id]?.map((image) => (
                  // Images are public marketing content; the URL is issued by the tenant-scoped API.
                  <img key={image.id} src={image.url} alt={`${roomType.name} room`} width="160" />
                ))}
                <label>
                  Upload photo
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => void uploadImage(roomType.id, event.target.files?.[0])}
                  />
                </label>
              </div>
              <div>
                <h5>Physical rooms</h5>
                <ul>
                  {rooms[roomType.id]?.map((room) => (
                    <li key={room.id}>
                      {room.name}{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setEditingRoom({ roomTypeId: roomType.id, roomId: room.id });
                          setRoomNames((current) => ({ ...current, [roomType.id]: room.name }));
                        }}
                      >
                        Edit
                      </button>{' '}
                      <button type="button" onClick={() => void deleteRoom(roomType.id, room.id)}>
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
                <form onSubmit={(event) => void submitRoom(event, roomType.id)}>
                  <label>
                    {editingRoom?.roomTypeId === roomType.id ? 'Room name' : 'New room name'}
                    <input
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
                  <button>
                    {editingRoom?.roomTypeId === roomType.id ? 'Save room' : 'Add room'}
                  </button>
                </form>
              </div>
            </article>
          ))}
          <h3>Amenities</h3>
          <p>Create property amenities, then tag the room types above.</p>
          <form onSubmit={submitAmenity}>
            <label>
              Amenity name
              <input
                required
                maxLength={100}
                value={amenityName}
                onChange={(event) => setAmenityName(event.target.value)}
              />
            </label>
            <button>Add amenity</button>
          </form>
          <ul>
            {amenities.map((amenity) => (
              <li key={amenity.id}>
                {amenity.name}{' '}
                <button type="button" onClick={() => void deleteAmenity(amenity.id)}>
                  Delete amenity
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {message ? <p role="alert">{message}</p> : null}
    </section>
  );
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return typeof body?.message === 'string' ? body.message : fallback;
}
