'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ImagePlus, Images, Star, Trash2 } from 'lucide-react';
import { ChangeEvent, DragEvent, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { libraryQueryKey, PropertyImageLibraryDialog } from './property-image-library';
import styles from './room-type-photo-gallery.module.css';

export type RoomTypeImage = { id: string; url: string; sortOrder: number; isPrimary: boolean };

const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxFileBytes = 10 * 1024 * 1024;
const maxImages = 13;

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

  useEffect(() => () => staged.forEach((photo) => URL.revokeObjectURL(photo.previewUrl)), [staged]);

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const uploaded: File[] = [];
      const failed: string[] = [];
      setUploadProgress({ uploaded: 0, total: files.length });
      for (const file of files) {
        try {
          const authorization = await fetch(`${roomTypesUrl}/${roomTypeId}/images`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ contentType: file.type, contentLength: file.size }),
          });
          if (!authorization.ok) {
            failed.push(
              `${file.name}: ${await errorMessage(authorization, 'upload could not be authorized')}`,
            );
            continue;
          }
          const { id, uploadUrl } = (await authorization.json()) as {
            id: string;
            uploadUrl: string;
          };
          const response = await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'content-type': file.type },
            body: file,
          });
          if (!response.ok) {
            await fetch(`${roomTypesUrl}/${roomTypeId}/images/${id}`, {
              method: 'DELETE',
              credentials: 'include',
            }).catch(() => undefined);
            failed.push(`${file.name}: upload failed`);
            continue;
          }
          uploaded.push(file);
          setUploadProgress({ uploaded: uploaded.length, total: files.length });
        } catch (error) {
          failed.push(`${file.name}: ${error instanceof Error ? error.message : 'upload failed'}`);
        }
      }
      return { uploaded, failed };
    },
    onSuccess: ({ uploaded, failed }) => {
      setStaged((current) => current.filter((photo) => !uploaded.includes(photo.file)));
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
      toast.error(error instanceof Error ? error.message : 'Unable to add photo URL.'),
  });

  const orderedImages = useMemo(
    () => [...images].sort((a, b) => a.sortOrder - b.sortOrder),
    [images],
  );

  function acceptFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) return;
    if (files.length > remainingSlots) {
      toast.error(`You can add ${Math.max(remainingSlots, 0)} more photos to this room type.`);
      return;
    }
    const unsupported = files.find((file) => !allowedTypes.has(file.type));
    if (unsupported) {
      toast.error(`${unsupported.name} is not a supported image. Choose JPG, PNG, or WebP.`);
      return;
    }
    const tooLarge = files.find((file) => file.size > maxFileBytes);
    if (tooLarge) {
      toast.error(`${tooLarge.name} is larger than the 10 MB upload limit.`);
      return;
    }
    setStaged((current) => [
      ...current,
      ...files.map((file) => ({ file, previewUrl: URL.createObjectURL(file) })),
    ]);
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) acceptFiles(event.target.files);
    event.target.value = '';
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    acceptFiles(event.dataTransfer.files);
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

  async function errorMessage(response: Response, fallback: string) {
    try {
      const body = (await response.json()) as { message?: string };
      return body.message || fallback;
    } catch {
      return fallback;
    }
  }

  return (
    <section className={styles.gallery} aria-labelledby={`room-photos-${roomTypeId}`}>
      <div className={styles.heading}>
        <div>
          <h3 id={`room-photos-${roomTypeId}`}>Room photos</h3>
          <p>Choose the photo guests see first; drag to arrange the rest of the gallery.</p>
        </div>
        <span className={styles.counter}>
          {images.length} / {maxImages}
        </span>
      </div>

      <div
        className={`${styles.dropzone} ${dragActive ? styles.dropzoneActive : ''}`}
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
        <ImagePlus aria-hidden="true" size={24} />
        <strong>Drag photos here, or choose files</strong>
        <span>JPG, PNG, or WebP · up to 10 MB each</span>
        <label className={styles.chooseButton}>
          Choose photos
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={remainingSlots <= 0 || uploadMutation.isPending}
            onChange={handleFileSelection}
          />
        </label>
      </div>

      <div className={styles.libraryRow}>
        <button
          className={styles.libraryButton}
          type="button"
          disabled={remainingSlots <= 0 || attachMutation.isPending}
          onClick={() => setLibraryOpen(true)}
        >
          <Images aria-hidden="true" size={16} /> Choose from library
        </button>
      </div>

      {orderedImages.length > 0 ? (
        <div className={styles.grid} aria-label="Uploaded room photos">
          {orderedImages.map((image, index) => (
            <article
              className={styles.photo}
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
              <img src={image.url} alt={`Room photo ${index + 1}`} />
              {image.isPrimary ? (
                <span className={styles.cover}>
                  <Star size={13} fill="currentColor" /> Primary
                </span>
              ) : null}
              <div className={styles.photoActions}>
                <button
                  className={styles.primaryAction}
                  type="button"
                  aria-label={
                    image.isPrimary
                      ? `Photo ${index + 1} is primary`
                      : `Set photo ${index + 1} as primary`
                  }
                  title={image.isPrimary ? 'Primary photo' : 'Set as primary'}
                  disabled={image.isPrimary || setPrimaryMutation.isPending}
                  onClick={() => setPrimaryMutation.mutate(image.id)}
                >
                  <Star size={16} fill={image.isPrimary ? 'currentColor' : 'none'} />
                  <span>{image.isPrimary ? 'Primary' : 'Set primary'}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Move photo ${index + 1} left`}
                  title="Move earlier"
                  disabled={index === 0 || reorderMutation.isPending}
                  onClick={() => movePhoto(image.id, index - 1)}
                >
                  <ArrowLeft size={16} />
                </button>
                <button
                  type="button"
                  aria-label={`Move photo ${index + 1} right`}
                  title="Move later"
                  disabled={index === orderedImages.length - 1 || reorderMutation.isPending}
                  onClick={() => movePhoto(image.id, index + 1)}
                >
                  <ArrowRight size={16} />
                </button>
                <button
                  type="button"
                  aria-label={`Remove photo ${index + 1}`}
                  title="Remove photo"
                  disabled={removeMutation.isPending}
                  onClick={() => setConfirmingImageId(image.id)}
                >
                  <Trash2 size={16} />
                </button>
              </div>
              {confirmingImageId === image.id ? (
                <div className={styles.confirm}>
                  <span>Remove this photo?</span>
                  <button
                    type="button"
                    onClick={() => removeMutation.mutate(image.id)}
                    disabled={removeMutation.isPending}
                  >
                    Remove
                  </button>
                  <button type="button" onClick={() => setConfirmingImageId(null)}>
                    Cancel
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className={styles.empty}>
          No photos yet. Add a few to show guests what this room looks like.
        </p>
      )}

      {staged.length ? (
        <div className={styles.stagedSection}>
          <div className={styles.heading}>
            <div>
              <h4>Ready to upload</h4>
              <p>
                {staged.length} {staged.length === 1 ? 'photo' : 'photos'} selected
              </p>
            </div>
            <div className={styles.stagedActions}>
              <button
                type="button"
                onClick={() => setStaged([])}
                disabled={uploadMutation.isPending}
              >
                Clear
              </button>
              <button
                className={styles.uploadButton}
                type="button"
                onClick={() => uploadMutation.mutate(staged.map((photo) => photo.file))}
                disabled={uploadMutation.isPending}
              >
                {uploadMutation.isPending
                  ? `Uploading ${uploadProgress?.uploaded ?? 0} of ${uploadProgress?.total ?? staged.length}…`
                  : `Upload ${staged.length} ${staged.length === 1 ? 'photo' : 'photos'}`}
              </button>
            </div>
          </div>
          <div className={styles.grid}>
            {staged.map((photo) => (
              <article
                className={styles.photo}
                key={`${photo.file.name}-${photo.file.lastModified}-${photo.file.size}`}
              >
                <img src={photo.previewUrl} alt={`Preview of ${photo.file.name}`} />
                <button
                  className={styles.removeStaged}
                  type="button"
                  aria-label={`Remove ${photo.file.name} from upload`}
                  onClick={() => setStaged((current) => current.filter((item) => item !== photo))}
                  disabled={uploadMutation.isPending}
                >
                  <Trash2 size={16} />
                </button>
                <span className={styles.filename}>{photo.file.name}</span>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <details className={styles.urlOption}>
        <summary>Add a photo by URL instead</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (url.trim()) addUrlMutation.mutate(url.trim());
          }}
        >
          <input
            aria-label="Photo URL"
            type="url"
            placeholder="https://example.com/room.jpg"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            required
          />
          <button type="submit" disabled={addUrlMutation.isPending || images.length >= maxImages}>
            {addUrlMutation.isPending ? 'Adding…' : 'Add URL'}
          </button>
        </form>
      </details>
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
    </section>
  );
}
