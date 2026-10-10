'use client';

import { useQuery } from '@tanstack/react-query';
import { Images, LoaderCircle } from 'lucide-react';
import { useState } from 'react';

import { Card, Heading, StatePanel, Text } from '@must/ui';

import { PropertyImageLibraryDialog } from './property-image-library';
import { RoomTypeMainImageSelector } from './room-type-main-image-selector';
import { RoomTypePhotoGallery, type RoomTypeImage } from './room-type-photo-gallery';

type PhotoRoomType = { id: string; name: string };

/**
 * Photos page for staff holding `photos.manage` (owners and admins also see it). Shares the
 * room-type and library components with Accommodations, but needs none of the owner/admin-only
 * room management endpoints.
 */
export function PhotosManagement({
  tenantId,
  propertyId,
}: {
  tenantId: string;
  propertyId: string;
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const roomTypesUrl = `/api/tenants/${tenantId}/properties/${propertyId}/room-types`;
  // Extends the Accommodations key so photo mutations (which invalidate that prefix) refresh this page.
  const query = useQuery({
    queryKey: ['dashboard', 'room-management', tenantId, propertyId, 'photos'] as const,
    queryFn: async () => {
      const response = await fetch(roomTypesUrl, { credentials: 'include' });
      if (!response.ok) throw new Error('Unable to load room types.');
      const roomTypes = (await response.json()) as PhotoRoomType[];
      const images = await Promise.all(
        roomTypes.map(async (roomType) => {
          const imageResponse = await fetch(`${roomTypesUrl}/${roomType.id}/images`, {
            credentials: 'include',
          });
          return [
            roomType.id,
            imageResponse.ok ? ((await imageResponse.json()) as RoomTypeImage[]) : [],
          ] as const;
        }),
      );
      return { roomTypes, images: Object.fromEntries(images) as Record<string, RoomTypeImage[]> };
    },
  });

  if (query.isPending)
    return (
      <StatePanel
        body={null}
        icon={<LoaderCircle aria-hidden="true" />}
        title="Loading photos…"
        variant="loading"
      />
    );
  if (query.isError)
    return (
      <StatePanel
        body="Try again in a moment."
        icon={<Images aria-hidden="true" />}
        title="Photos could not be loaded"
        variant="error"
      />
    );

  return (
    <div style={{ display: 'grid', gap: 'var(--space-lg, 24px)' }}>
      <div>
        <Heading level={2}>Photos</Heading>
        <Text tone="secondary">Manage the photos guests see for each room type.</Text>
      </div>
      <Card>
        <Heading level={3}>Photo library</Heading>
        <Text tone="secondary">Upload property photos once and reuse them across room types.</Text>
        <button
          className="must-button must-button--secondary"
          type="button"
          onClick={() => setLibraryOpen(true)}
        >
          <Images aria-hidden="true" size={16} /> Manage library
        </button>
      </Card>
      {libraryOpen ? (
        <PropertyImageLibraryDialog
          tenantId={tenantId}
          propertyId={propertyId}
          mode="manage"
          title="Photo library"
          onClose={() => setLibraryOpen(false)}
        />
      ) : null}
      {query.data.roomTypes.length === 0 ? <Text>No room types yet.</Text> : null}
      {query.data.roomTypes.map((roomType) => {
        const images = query.data.images[roomType.id] ?? [];
        return (
          <Card key={roomType.id}>
            <Heading level={3}>{roomType.name}</Heading>
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
          </Card>
        );
      })}
    </div>
  );
}
