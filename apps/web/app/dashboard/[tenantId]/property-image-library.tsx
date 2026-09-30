'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ImagePlus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import styles from './property-image-library.module.css';

export type LibraryImage = {
  id: string;
  url: string;
  originalName: string | null;
  usageCount: number;
};

export const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const maxImageBytes = 10 * 1024 * 1024;

export function libraryUrl(tenantId: string, propertyId: string) {
  return `/api/tenants/${tenantId}/properties/${propertyId}/image-library`;
}

export function libraryQueryKey(tenantId: string, propertyId: string) {
  return ['dashboard', 'image-library', tenantId, propertyId] as const;
}

export async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return typeof body?.message === 'string' ? body.message : fallback;
}

/** Uploads one file into the property library and returns the new library image id. */
export async function uploadToLibrary(
  tenantId: string,
  propertyId: string,
  file: File,
): Promise<string> {
  const base = libraryUrl(tenantId, propertyId);
  const authorization = await fetch(base, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contentType: file.type, contentLength: file.size, name: file.name }),
  });
  if (!authorization.ok)
    throw new Error(await errorMessage(authorization, 'The upload could not be authorized.'));
  const { id, uploadUrl } = (await authorization.json()) as { id: string; uploadUrl: string };
  const upload = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': file.type },
    body: file,
  });
  if (!upload.ok) {
    await fetch(`${base}/${id}`, { method: 'DELETE', credentials: 'include' }).catch(
      () => undefined,
    );
    throw new Error('The image could not be uploaded.');
  }
  // Second phase: the API verifies the file reached storage before the photo is published.
  const confirmation = await fetch(`${base}/${id}/confirm`, {
    method: 'POST',
    credentials: 'include',
  });
  if (!confirmation.ok) {
    await fetch(`${base}/${id}`, { method: 'DELETE', credentials: 'include' }).catch(
      () => undefined,
    );
    throw new Error(await errorMessage(confirmation, 'The image could not be verified.'));
  }
  return id;
}

export function validateImageFile(file: File): string | null {
  if (!allowedImageTypes.has(file.type))
    return `${file.name} is not a supported image. Choose JPG, PNG, or WebP.`;
  if (file.size > maxImageBytes) return `${file.name} is larger than the 10 MB upload limit.`;
  return null;
}

/**
 * The property photo library. `single`/`multi` pick photos for a room type; `manage`
 * is the library on its own (upload and delete).
 */
export function PropertyImageLibraryDialog({
  tenantId,
  propertyId,
  mode,
  title,
  confirmLabel,
  attachedUrls,
  maxSelectable,
  busy,
  onConfirm,
  onClose,
}: {
  tenantId: string;
  propertyId: string;
  mode: 'single' | 'multi' | 'manage';
  title: string;
  confirmLabel?: string;
  attachedUrls?: ReadonlySet<string>;
  maxSelectable?: number;
  busy?: boolean;
  onConfirm?: (libraryImageIds: string[]) => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = libraryQueryKey(tenantId, propertyId);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const libraryQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await fetch(libraryUrl(tenantId, propertyId), { credentials: 'include' });
      if (!response.ok)
        throw new Error(await errorMessage(response, 'Unable to load the library.'));
      return (await response.json()) as LibraryImage[];
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const uploadedIds: string[] = [];
      const failed: string[] = [];
      setProgress({ done: 0, total: files.length });
      for (const file of files) {
        try {
          uploadedIds.push(await uploadToLibrary(tenantId, propertyId, file));
        } catch (error) {
          failed.push(`${file.name}: ${error instanceof Error ? error.message : 'upload failed'}`);
        }
        setProgress({ done: uploadedIds.length + failed.length, total: files.length });
      }
      return { uploadedIds, failed };
    },
    onSuccess: ({ uploadedIds, failed }) => {
      setProgress(null);
      void queryClient.invalidateQueries({ queryKey });
      if (uploadedIds.length) {
        toast.success(
          `${uploadedIds.length} ${uploadedIds.length === 1 ? 'photo' : 'photos'} added to the library.`,
        );
        if (mode !== 'manage') {
          setSelected((current) =>
            mode === 'single'
              ? [uploadedIds[0]]
              : [...current, ...uploadedIds].slice(0, maxSelectable ?? Infinity),
          );
        }
      }
      if (failed.length) toast.error(failed.join(' · '));
    },
    onError: (error) => {
      setProgress(null);
      toast.error(error instanceof Error ? error.message : 'Unable to upload photos.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (imageId: string) => {
      const response = await fetch(`${libraryUrl(tenantId, propertyId)}/${imageId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error(await errorMessage(response, 'Unable to delete photo.'));
    },
    onSuccess: () => {
      setConfirmingDeleteId(null);
      void queryClient.invalidateQueries({ queryKey });
      toast.success('Photo deleted from the library.');
    },
    onError: (error) => {
      setConfirmingDeleteId(null);
      toast.error(error instanceof Error ? error.message : 'Unable to delete photo.');
    },
  });

  function acceptFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    const problem = files.map(validateImageFile).find(Boolean);
    if (problem) {
      toast.error(problem);
      return;
    }
    uploadMutation.mutate(files);
  }

  function toggle(image: LibraryImage) {
    if (mode === 'manage' || attachedUrls?.has(image.url)) return;
    setSelected((current) => {
      if (mode === 'single') return current[0] === image.id ? [] : [image.id];
      if (current.includes(image.id)) return current.filter((id) => id !== image.id);
      if (maxSelectable !== undefined && current.length >= maxSelectable) {
        toast.error(
          `You can add ${maxSelectable} more ${maxSelectable === 1 ? 'photo' : 'photos'}.`,
        );
        return current;
      }
      return [...current, image.id];
    });
  }

  const images = libraryQuery.data ?? [];

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-label={title}>
        <header className={styles.header}>
          <div>
            <h3>{title}</h3>
            <p>
              {mode === 'manage'
                ? 'Photos uploaded here can be reused by any room type in this property.'
                : 'Choose from the property library, or upload new photos to it.'}
            </p>
          </div>
          <button className={styles.iconButton} type="button" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className={styles.toolbar}>
          <label className={styles.uploadButton}>
            <ImagePlus aria-hidden="true" size={16} />
            <span>
              {progress
                ? `Uploading ${progress.done} of ${progress.total}…`
                : mode === 'single'
                  ? 'Upload a new photo'
                  : 'Upload photos'}
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple={mode !== 'single'}
              disabled={uploadMutation.isPending}
              onChange={(event) => {
                acceptFiles(event.target.files);
                event.target.value = '';
              }}
            />
          </label>
          <span className={styles.count}>
            {images.length} {images.length === 1 ? 'photo' : 'photos'} in library
          </span>
        </div>

        <div className={styles.body}>
          {libraryQuery.isLoading ? <p className={styles.empty}>Loading the library…</p> : null}
          {libraryQuery.isError ? (
            <p className={styles.empty}>
              {libraryQuery.error instanceof Error
                ? libraryQuery.error.message
                : 'Unable to load the library.'}
            </p>
          ) : null}
          {!libraryQuery.isLoading && !libraryQuery.isError && images.length === 0 ? (
            <p className={styles.empty}>The library is empty. Upload photos to get started.</p>
          ) : null}
          {images.length > 0 ? (
            <div className={styles.grid}>
              {images.map((image, index) => {
                const alreadyAdded = attachedUrls?.has(image.url) === true;
                const isSelected = selected.includes(image.id);
                return (
                  <article
                    className={`${styles.tile} ${isSelected ? styles.tileSelected : ''} ${alreadyAdded ? styles.tileDisabled : ''}`}
                    key={image.id}
                  >
                    <button
                      className={styles.tileButton}
                      type="button"
                      disabled={mode === 'manage' || alreadyAdded}
                      aria-pressed={mode === 'manage' ? undefined : isSelected}
                      aria-label={`${alreadyAdded ? 'Already added: ' : ''}Library photo ${index + 1}${image.originalName ? `, ${image.originalName}` : ''}`}
                      onClick={() => toggle(image)}
                    >
                      <img src={image.url} alt="" loading="lazy" />
                    </button>
                    {isSelected ? (
                      <span className={styles.check}>
                        <Check size={14} />
                      </span>
                    ) : null}
                    {alreadyAdded ? <span className={styles.badge}>Added</span> : null}
                    {mode === 'manage' && image.usageCount > 0 ? (
                      <span className={styles.badge}>
                        Used by {image.usageCount} {image.usageCount === 1 ? 'room' : 'rooms'}
                      </span>
                    ) : null}
                    {mode === 'manage' ? (
                      confirmingDeleteId === image.id ? (
                        <div className={styles.confirm}>
                          <span>Delete this photo?</span>
                          <button
                            type="button"
                            disabled={deleteMutation.isPending}
                            onClick={() => deleteMutation.mutate(image.id)}
                          >
                            Delete
                          </button>
                          <button type="button" onClick={() => setConfirmingDeleteId(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          className={styles.deleteButton}
                          type="button"
                          aria-label={`Delete library photo ${index + 1}`}
                          title="Delete from library"
                          onClick={() => setConfirmingDeleteId(image.id)}
                        >
                          <Trash2 size={15} />
                        </button>
                      )
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : null}
        </div>

        {mode !== 'manage' ? (
          <footer className={styles.footer}>
            <button className={styles.secondary} type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className={styles.primary}
              type="button"
              disabled={!selected.length || busy || uploadMutation.isPending}
              onClick={() => onConfirm?.(selected)}
            >
              {busy
                ? 'Saving…'
                : (confirmLabel ??
                  (mode === 'single'
                    ? 'Use this photo'
                    : `Add ${selected.length || ''} ${selected.length === 1 ? 'photo' : 'photos'}`.replace(
                        '  ',
                        ' ',
                      )))}
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  );
}
