'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Image as ImageIcon, ImagePlus, Images } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  errorMessage,
  libraryQueryKey,
  PropertyImageLibraryDialog,
  uploadToLibrary,
  validateImageFile,
} from './property-image-library';
import type { RoomTypeImage } from './room-type-photo-gallery';
import styles from './room-type-main-image-selector.module.css';

const maxImages = 13;

export function RoomTypeMainImageSelector({
  tenantId,
  propertyId,
  roomTypeId,
  roomTypeName,
  images,
}: {
  tenantId: string;
  propertyId: string;
  roomTypeId: string;
  roomTypeName: string;
  images: RoomTypeImage[];
}) {
  const queryClient = useQueryClient();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const roomTypesUrl = `/api/tenants/${tenantId}/properties/${propertyId}/room-types`;
  const queryKey = ['dashboard', 'room-management', tenantId, propertyId] as const;
  const primaryImage = images.find((image) => image.isPrimary);

  // Adds the chosen library photo to the room type (if needed) and makes it the main image.
  const chooseMutation = useMutation({
    mutationFn: async (libraryImageId: string) => {
      const response = await fetch(`${roomTypesUrl}/${roomTypeId}/images/from-library`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ libraryImageIds: [libraryImageId], asPrimary: true }),
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to update the main image.'));
    },
    onSuccess: () => {
      setLibraryOpen(false);
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: libraryQueryKey(tenantId, propertyId) });
      toast.success('Main image updated.');
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey });
      toast.error(error instanceof Error ? error.message : 'Unable to update the main image.');
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const libraryImageId = await uploadToLibrary(tenantId, propertyId, file);
      const response = await fetch(`${roomTypesUrl}/${roomTypeId}/images/from-library`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ libraryImageIds: [libraryImageId], asPrimary: true }),
      });
      if (!response.ok)
        throw new Error(
          await errorMessage(response, 'The image uploaded but could not be selected.'),
        );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: libraryQueryKey(tenantId, propertyId) });
      toast.success('Main image uploaded and selected.');
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: libraryQueryKey(tenantId, propertyId) });
      toast.error(error instanceof Error ? error.message : 'Unable to upload the main image.');
    },
  });

  function chooseUpload(file: File | undefined) {
    if (!file) return;
    const problem = validateImageFile(file);
    if (problem) {
      toast.error(problem);
      return;
    }
    uploadMutation.mutate(file);
  }

  const busy = chooseMutation.isPending || uploadMutation.isPending;

  return (
    <section className={styles.selector} aria-labelledby={`main-image-title-${roomTypeId}`}>
      <div className={styles.heading}>
        <div>
          <h3 id={`main-image-title-${roomTypeId}`}>Main image</h3>
          <p>The single photo guests see first. Upload a new one or pick it from the library.</p>
        </div>
      </div>
      <div className={styles.content}>
        <div className={styles.preview}>
          {primaryImage ? (
            <img src={primaryImage.url} alt={`Current main image for ${roomTypeName}`} />
          ) : (
            <span className={styles.placeholder}>
              <ImageIcon aria-hidden="true" size={28} />
              <span>No main image yet</span>
            </span>
          )}
        </div>
        <div className={styles.control}>
          <div className={styles.actions}>
            <button
              className={styles.actionButton}
              type="button"
              disabled={busy}
              onClick={() => setLibraryOpen(true)}
            >
              <Images aria-hidden="true" size={16} />
              <span>{primaryImage ? 'Change from library' : 'Choose from library'}</span>
            </button>
            <label
              className={styles.actionButton}
              aria-disabled={busy || images.length >= maxImages}
            >
              <ImagePlus aria-hidden="true" size={16} />
              <span>{uploadMutation.isPending ? 'Uploading…' : 'Upload a new photo'}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={busy || (!primaryImage && images.length >= maxImages)}
                onChange={(event) => {
                  chooseUpload(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>
          </div>
          <p className={styles.hint}>
            The main image is also part of the room’s gallery. New uploads are saved to the property
            library.
          </p>
        </div>
      </div>
      {libraryOpen ? (
        <PropertyImageLibraryDialog
          tenantId={tenantId}
          propertyId={propertyId}
          mode="single"
          title="Choose the main image"
          busy={chooseMutation.isPending}
          onConfirm={([libraryImageId]) => chooseMutation.mutate(libraryImageId)}
          onClose={() => setLibraryOpen(false)}
        />
      ) : null}
    </section>
  );
}
