'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Image as ImageIcon, ImagePlus, Images } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import {
  checkImageFiles,
  errorMessage,
  libraryQueryKey,
  PropertyImageLibraryDialog,
  uploadToLibrary,
} from './property-image-library';
import type { RoomTypeImage } from './room-type-photo-gallery';

const maxImages = 21;

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const roomTypesUrl = `/api/tenants/${tenantId}/properties/${propertyId}/room-types`;
  const queryKey = ['dashboard', 'room-management', tenantId, propertyId] as const;
  const primaryImage = images.find((image) => image.isPrimary);
  const hasRoom = images.length < maxImages;

  // Adds the chosen library photo to this gallery and selects it as the cover.
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

  async function chooseUpload(file: File | undefined) {
    if (!file) return;
    const problem = await checkImageFiles([file]);
    if (problem) {
      toast.error(problem);
      return;
    }
    uploadMutation.mutate(file);
  }

  const busy = chooseMutation.isPending || uploadMutation.isPending;

  return (
    <Card className="gap-4 border-primary/15 bg-primary/5 p-4 sm:p-5">
      <CardHeader className="px-0 py-0">
        <CardTitle>Main image</CardTitle>
        <CardDescription>The primary photo guests see first.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 px-0 md:grid-cols-[minmax(0,10rem)_1fr] md:items-center">
        <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border bg-muted">
          {primaryImage ? (
            <img
              src={primaryImage.url}
              alt={`Current main image for ${roomTypeName}`}
              className="size-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <ImageIcon aria-hidden="true" className="size-7" />
              <span>No main image yet</span>
            </div>
          )}
        </div>
        <div className="flex flex-col items-start gap-3">
          <p className="m-0 text-sm text-muted-foreground">
            The main image is part of the room type gallery. New uploads are saved to the property
            library.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy || !hasRoom}
              onClick={() => setLibraryOpen(true)}
            >
              <Images aria-hidden="true" />
              {primaryImage ? 'Change from library' : 'Choose from library'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !hasRoom}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus aria-hidden="true" />
              {busy ? 'Uploading…' : 'Upload a new photo'}
            </Button>
            <Input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="Upload a new main photo"
              disabled={busy || !hasRoom}
              onChange={(event) => {
                void chooseUpload(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
          </div>
        </div>
      </CardContent>
      {libraryOpen ? (
        <PropertyImageLibraryDialog
          tenantId={tenantId}
          propertyId={propertyId}
          mode="single"
          title="Choose the main image"
          attachedUrls={new Set(images.map((image) => image.url))}
          maxSelectable={hasRoom ? 1 : 0}
          busy={chooseMutation.isPending}
          onConfirm={([libraryImageId]) => chooseMutation.mutate(libraryImageId)}
          onClose={() => setLibraryOpen(false)}
        />
      ) : null}
    </Card>
  );
}
