'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ImagePlus, Images, Star, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import {
  checkImageFiles,
  libraryQueryKey,
  PropertyImageLibraryDialog,
} from './property-image-library';

export type RoomTypeImage = { id: string; url: string; sortOrder: number; isPrimary: boolean };

const maxImages = 21;

type StagedPhoto = { file: File; previewUrl: string };

export function RoomTypePhotoGallery({
  tenantId,
  propertyId,
  roomTypeId,
  images,
}: {
  tenantId: string;
  propertyId: string;
  roomTypeId: string;
  images: RoomTypeImage[];
}) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stagedPreviewUrls = useRef(new Set<string>());
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  const [url, setUrl] = useState('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [confirmingImageId, setConfirmingImageId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ uploaded: number; total: number } | null>(
    null,
  );
  const roomTypesUrl = `/api/tenants/${tenantId}/properties/${propertyId}/room-types`;
  const queryKey = ['dashboard', 'room-management', tenantId, propertyId] as const;
  const remainingSlots = maxImages - images.length - staged.length;

  useEffect(
    () => () => {
      for (const previewUrl of stagedPreviewUrls.current) URL.revokeObjectURL(previewUrl);
      stagedPreviewUrls.current.clear();
    },
    [],
  );

  const uploadMutation = useMutation({
    mutationFn: async (photos: StagedPhoto[]) => {
      const uploaded: StagedPhoto[] = [];
      const failed: string[] = [];
      setUploadProgress({ uploaded: 0, total: photos.length });
      for (const photo of photos) {
        try {
          const authorization = await fetch(`${roomTypesUrl}/${roomTypeId}/images`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              contentType: photo.file.type,
              contentLength: photo.file.size,
            }),
          });
          if (!authorization.ok) {
            failed.push(
              `${photo.file.name}: ${await errorMessage(authorization, 'upload could not be authorized')}`,
            );
            continue;
          }
          const { id, uploadUrl } = (await authorization.json()) as {
            id: string;
            uploadUrl: string;
          };
          const response = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'content-type': photo.file.type },
            body: photo.file,
          });
          if (!response.ok) {
            await fetch(`${roomTypesUrl}/${roomTypeId}/images/${id}`, {
              method: 'DELETE',
              credentials: 'include',
            }).catch(() => undefined);
            failed.push(`${photo.file.name}: upload failed`);
            continue;
          }
          uploaded.push(photo);
          setUploadProgress({ uploaded: uploaded.length, total: photos.length });
        } catch (error) {
          failed.push(
            `${photo.file.name}: ${error instanceof Error ? error.message : 'upload failed'}`,
          );
        }
      }
      return { uploaded, failed };
    },
    onSuccess: ({ uploaded, failed }) => {
      setStaged((current) => current.filter((photo) => !uploaded.includes(photo)));
      for (const photo of uploaded) {
        URL.revokeObjectURL(photo.previewUrl);
        stagedPreviewUrls.current.delete(photo.previewUrl);
      }
      setUploadProgress(null);
      void queryClient.invalidateQueries({ queryKey });
      if (uploaded.length)
        toast.success(`${uploaded.length} ${uploaded.length === 1 ? 'photo' : 'photos'} uploaded.`);
      if (failed.length) toast.error(failed.join(' · '));
    },
    onError: (error) => {
      setUploadProgress(null);
      void queryClient.invalidateQueries({ queryKey });
      toast.error(error instanceof Error ? error.message : 'Unable to upload photos.');
    },
  });

  const attachMutation = useMutation({
    mutationFn: async (libraryImageIds: string[]) => {
      const response = await fetch(`${roomTypesUrl}/${roomTypeId}/images/from-library`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ libraryImageIds }),
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to add photos from the library.'));
      return (await response.json()) as { added: number };
    },
    onSuccess: ({ added }) => {
      setLibraryOpen(false);
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: libraryQueryKey(tenantId, propertyId) });
      toast.success(`${added} ${added === 1 ? 'photo' : 'photos'} added.`);
    },
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'Unable to add photos from the library.',
      ),
  });

  const reorderMutation = useMutation({
    mutationFn: async (imageIds: string[]) => {
      const response = await fetch(`${roomTypesUrl}/${roomTypeId}/images/order`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageIds }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to reorder photos.'));
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey }),
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey });
      toast.error(error instanceof Error ? error.message : 'Unable to reorder photos.');
    },
  });

  const setPrimaryMutation = useMutation({
    mutationFn: async (imageId: string) => {
      const response = await fetch(`${roomTypesUrl}/${roomTypeId}/images/primary`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageId }),
      });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to select the primary photo.'));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      toast.success('Primary photo updated.');
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey });
      toast.error(error instanceof Error ? error.message : 'Unable to select the primary photo.');
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (imageId: string) => {
      const response = await fetch(`${roomTypesUrl}/${roomTypeId}/images/${imageId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to remove photo.'));
    },
    onSuccess: () => {
      setConfirmingImageId(null);
      void queryClient.invalidateQueries({ queryKey });
      toast.success('Photo removed.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to remove photo.'),
  });

  const addUrlMutation = useMutation({
    mutationFn: async (imageUrl: string) => {
      const response = await fetch(`${roomTypesUrl}/${roomTypeId}/images/from-url`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: imageUrl }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to add photo URL.'));
    },
    onSuccess: () => {
      setUrl('');
      void queryClient.invalidateQueries({ queryKey });
      toast.success('Photo added.');
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : 'Unable to add photo.'),
  });

  const orderedImages = useMemo(
    () => [...images].sort((a, b) => a.sortOrder - b.sortOrder),
    [images],
  );

  async function acceptFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) return;
    if (files.length > remainingSlots) {
      toast.error(`You can add ${Math.max(remainingSlots, 0)} more photos to this room type.`);
      return;
    }
    const problem = await checkImageFiles(files);
    if (problem) {
      toast.error(problem);
      return;
    }
    const next = files.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      stagedPreviewUrls.current.add(previewUrl);
      return { file, previewUrl };
    });
    setStaged((current) => [...current, ...next]);
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void acceptFiles(event.target.files);
    event.target.value = '';
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    void acceptFiles(event.dataTransfer.files);
  }

  function movePhoto(imageId: string, destination: number) {
    const current = [...orderedImages];
    const source = current.findIndex((image) => image.id === imageId);
    if (source < 0 || destination < 0 || destination >= current.length || source === destination)
      return;
    const [photo] = current.splice(source, 1);
    current.splice(destination, 0, photo);
    reorderMutation.mutate(current.map((image) => image.id));
  }

  function removeStagedPhoto(photo: StagedPhoto) {
    setStaged((current) => current.filter((item) => item !== photo));
    URL.revokeObjectURL(photo.previewUrl);
    stagedPreviewUrls.current.delete(photo.previewUrl);
  }

  return (
    <Card className="gap-4 p-4 sm:p-5">
      <CardHeader className="flex flex-row items-start justify-between gap-3 px-0 py-0">
        <div className="flex flex-col gap-1">
          <CardTitle>Room photos</CardTitle>
          <CardDescription>
            Choose the photo guests see first and arrange the gallery.
          </CardDescription>
        </div>
        <Badge variant="secondary">
          {images.length} / {maxImages}
        </Badge>
      </CardHeader>

      <CardContent className="flex flex-col gap-4 px-0">
        <div
          className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-4 py-7 text-center transition-colors ${dragActive ? 'border-primary bg-primary/5' : 'bg-muted/20'}`}
          aria-label="Photo upload area"
          onDragEnter={(event) => {
            event.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setDragActive(false);
          }}
          onDrop={handleDrop}
        >
          <ImagePlus aria-hidden="true" className="size-6 text-primary" />
          <div>
            <p className="m-0 text-sm font-semibold">Drag photos here, or choose files</p>
            <p className="m-0 mt-1 text-xs text-muted-foreground">
              JPG, PNG, or WebP · up to 10 MB each
            </p>
          </div>
          <Input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            aria-label="Choose room photos"
            disabled={remainingSlots <= 0 || uploadMutation.isPending}
            onChange={handleFileSelection}
          />
          <Button
            type="button"
            variant="outline"
            disabled={remainingSlots <= 0 || uploadMutation.isPending}
            onClick={() => fileInputRef.current?.click()}
          >
            Choose photos
          </Button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="m-0 text-sm text-muted-foreground">
            Uploads are added to the property photo library too.
          </p>
          <Button
            type="button"
            variant="secondary"
            disabled={remainingSlots <= 0 || attachMutation.isPending}
            onClick={() => setLibraryOpen(true)}
          >
            <Images aria-hidden="true" /> Choose from library
          </Button>
        </div>

        {orderedImages.length ? (
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
            aria-label="Uploaded room photos"
          >
            {orderedImages.map((image, index) => (
              <Card
                className="overflow-hidden gap-0 py-0"
                key={image.id}
                draggable={!reorderMutation.isPending}
                onDragStart={() => setDraggedId(image.id)}
                onDragEnd={() => setDraggedId(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedId) movePhoto(draggedId, index);
                  setDraggedId(null);
                }}
              >
                <div className="relative aspect-[4/3] bg-muted">
                  <img
                    src={image.url}
                    alt={`Room photo ${index + 1}`}
                    className="size-full object-cover"
                  />
                  {image.isPrimary ? (
                    <Badge className="absolute top-2 left-2" variant="success">
                      <Star aria-hidden="true" fill="currentColor" /> Primary
                    </Badge>
                  ) : null}
                </div>
                <CardContent className="flex flex-col gap-2 p-3">
                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={image.isPrimary ? 'secondary' : 'outline'}
                      aria-label={
                        image.isPrimary
                          ? `Photo ${index + 1} is primary`
                          : `Set photo ${index + 1} as primary`
                      }
                      disabled={image.isPrimary || setPrimaryMutation.isPending}
                      onClick={() => setPrimaryMutation.mutate(image.id)}
                    >
                      <Star aria-hidden="true" fill={image.isPrimary ? 'currentColor' : 'none'} />
                      {image.isPrimary ? 'Primary' : 'Set primary'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move photo ${index + 1} left`}
                      title="Move earlier"
                      disabled={index === 0 || reorderMutation.isPending}
                      onClick={() => movePhoto(image.id, index - 1)}
                    >
                      <ArrowLeft aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Move photo ${index + 1} right`}
                      title="Move later"
                      disabled={index === orderedImages.length - 1 || reorderMutation.isPending}
                      onClick={() => movePhoto(image.id, index + 1)}
                    >
                      <ArrowRight aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove photo ${index + 1}`}
                      title="Remove photo"
                      disabled={removeMutation.isPending}
                      onClick={() => setConfirmingImageId(image.id)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                  {confirmingImageId === image.id ? (
                    <Alert
                      variant="warning"
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <AlertDescription>Remove this photo?</AlertDescription>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          loading={removeMutation.isPending}
                          onClick={() => removeMutation.mutate(image.id)}
                        >
                          Remove
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setConfirmingImageId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </Alert>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
            No photos yet. Add a few to show guests what this room looks like.
          </div>
        )}

        {staged.length ? (
          <section
            className="flex flex-col gap-3 border-t pt-4"
            aria-label="Photos ready to upload"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="m-0 text-sm font-semibold">Ready to upload</h4>
                <p className="m-0 mt-1 text-xs text-muted-foreground">
                  {staged.length} {staged.length === 1 ? 'photo' : 'photos'} selected
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={uploadMutation.isPending}
                  onClick={() => {
                    for (const photo of staged) {
                      URL.revokeObjectURL(photo.previewUrl);
                      stagedPreviewUrls.current.delete(photo.previewUrl);
                    }
                    setStaged([]);
                  }}
                >
                  Clear
                </Button>
                <Button
                  type="button"
                  loading={uploadMutation.isPending}
                  onClick={() => uploadMutation.mutate(staged)}
                >
                  {uploadMutation.isPending
                    ? `Uploading ${uploadProgress?.uploaded ?? 0} of ${uploadProgress?.total ?? staged.length}…`
                    : `Upload ${staged.length} ${staged.length === 1 ? 'photo' : 'photos'}`}
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {staged.map((photo) => (
                <Card className="overflow-hidden gap-2 py-0" key={photo.previewUrl}>
                  <div className="relative aspect-[4/3] bg-muted">
                    <img
                      src={photo.previewUrl}
                      alt={`Preview of ${photo.file.name}`}
                      className="size-full object-cover"
                    />
                  </div>
                  <CardContent className="flex items-center justify-between gap-2 p-3">
                    <span className="min-w-0 truncate text-xs text-muted-foreground">
                      {photo.file.name}
                    </span>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${photo.file.name} from upload`}
                      disabled={uploadMutation.isPending}
                      onClick={() => removeStagedPhoto(photo)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ) : null}

        <details className="rounded-md border px-3 py-2">
          <summary className="cursor-pointer text-sm font-semibold">
            Add a photo by URL instead
          </summary>
          <form
            className="flex flex-col items-end gap-3 pt-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              if (url.trim()) addUrlMutation.mutate(url.trim());
            }}
          >
            <FormField className="w-full" label="Photo URL" htmlFor={`photo-url-${roomTypeId}`}>
              <Input
                id={`photo-url-${roomTypeId}`}
                type="url"
                placeholder="https://example.com/room.jpg"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                required
              />
            </FormField>
            <Button
              type="submit"
              className="w-full sm:w-auto"
              loading={addUrlMutation.isPending}
              disabled={remainingSlots <= 0}
            >
              Add URL
            </Button>
          </form>
        </details>
      </CardContent>

      {libraryOpen ? (
        <PropertyImageLibraryDialog
          tenantId={tenantId}
          propertyId={propertyId}
          mode="multi"
          title="Add photos from the library"
          attachedUrls={new Set(images.map((image) => image.url))}
          maxSelectable={Math.max(maxImages - images.length, 0)}
          busy={attachMutation.isPending}
          onConfirm={(ids) => attachMutation.mutate(ids)}
          onClose={() => setLibraryOpen(false)}
        />
      ) : null}
    </Card>
  );
}

async function errorMessage(response: Response, fallback: string) {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message || fallback;
  } catch {
    return fallback;
  }
}
