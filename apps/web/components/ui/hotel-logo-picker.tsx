'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ImageIcon, Upload } from 'lucide-react';
import { Button } from './button';
import { Input } from './input';
import { FormField } from './form-field';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './dialog';
import { Alert, AlertDescription } from './alert';
import { cn } from '../../lib/utils';
import {
  libraryUrl,
  libraryQueryKey,
  uploadToLibrary,
  validateImageFile,
  type LibraryImage,
} from '../../app/dashboard/[tenantId]/property-image-library';

const PAGE = 24;
const IMAGE_EXTENSION = /\.(png|jpe?g|webp)(?:[?#]|$)/i;

/** A logo must be reachable by email apps and browsers: a full https link, or a path on this site. */
function usableLogoUrl(url: string): boolean {
  if (!IMAGE_EXTENSION.test(url)) return false;
  return /^https:\/\//i.test(url) || /^\/(?!\/)/.test(url);
}

/** A light checkered backdrop, so a logo with a transparent background is visible whatever its colour. */
const CHECKER =
  'repeating-conic-gradient(var(--muted, #eee) 0% 25%, transparent 0% 50%) 50% / 16px 16px';

/** How each kind of brand image is shown and described. */
const KINDS = {
  logo: {
    label: 'Hotel logo',
    noun: 'logo',
    hint: 'PNG, JPG or WebP, up to 10 MB. A wide logo at least 400 pixels across stays sharp in emails.',
    box: 'h-24 w-48',
    fit: 'object-contain',
  },
  dark: {
    label: 'Logo for dark backgrounds',
    noun: 'dark logo',
    hint: 'A light version of the logo. Without it the main logo is shown on a white strip.',
    box: 'h-24 w-48',
    fit: 'object-contain',
  },
  icon: {
    label: 'Square icon',
    noun: 'icon',
    hint: 'At least 512 × 512 pixels. Shown cropped to a square; used in the hotel switcher and for sharing.',
    box: 'size-24 rounded-2xl',
    fit: 'object-cover',
  },
  favicon: {
    label: 'Favicon',
    noun: 'favicon',
    hint: 'The small image in the browser tab. Made from the square icon unless you choose another.',
    box: 'size-16 rounded-lg',
    fit: 'object-cover',
  },
  cover: {
    label: 'Cover photo',
    noun: 'cover photo',
    hint: 'A landscape photo at least 1600 pixels wide, for the top of the booking page and emails.',
    box: 'h-24 w-48',
    fit: 'object-cover',
  },
} as const;
export type BrandImageKind = keyof typeof KINDS;

export function HotelLogoPicker({
  tenantId,
  propertyId,
  value,
  onChange,
  canManage,
  kind = 'logo',
}: {
  tenantId: string;
  propertyId: string;
  value: string;
  onChange: (url: string) => void;
  canManage: boolean;
  /** Which brand image this is; the default is the main logo. */
  kind?: BrandImageKind;
}) {
  const copy = KINDS[kind];
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [shown, setShown] = useState(PAGE);
  const client = useQueryClient();
  const load = async () => {
    const r = await fetch(libraryUrl(tenantId, propertyId), { credentials: 'include' });
    if (!r.ok) throw new Error('Could not open the hotel photo library.');
    return (await r.json()) as LibraryImage[];
  };
  const query = useQuery({
    queryKey: libraryQueryKey(tenantId, propertyId),
    queryFn: load,
    enabled: open && canManage,
  });
  const select = (url: string) => {
    if (!usableLogoUrl(url)) {
      setError('Choose a PNG, JPG or WebP image that is reachable from the internet.');
      return;
    }
    onChange(url);
    setOpen(false);
    setError('');
  };
  async function upload(file: File) {
    const problem = validateImageFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const id = await uploadToLibrary(tenantId, propertyId, file);
      const images = await load();
      client.setQueryData(libraryQueryKey(tenantId, propertyId), images);
      const image = images.find((i) => i.id === id);
      if (!image)
        throw new Error('The uploaded image is not ready. Try choosing it from the library again.');
      select(image.url);
    } catch {
      setError(`Could not upload this ${copy.noun}. Check photo access and try again.`);
    } finally {
      setBusy(false);
    }
  }
  const images = query.data ?? [];
  return (
    <FormField label={copy.label} hint={copy.hint}>
      <div className="flex flex-wrap items-center gap-4">
        <div
          className={cn(
            'flex items-center justify-center overflow-hidden rounded-lg border bg-card',
            copy.box,
            copy.fit === 'object-contain' && 'p-2',
          )}
          style={
            value
              ? kind === 'dark'
                ? { background: '#1f2933' }
                : copy.fit === 'object-contain'
                  ? { background: CHECKER }
                  : undefined
              : undefined
          }
        >
          {value ? (
            <img
              src={value}
              alt={`Current ${copy.noun}`}
              className={cn(
                copy.fit === 'object-cover'
                  ? 'size-full object-cover'
                  : 'max-h-full max-w-full object-contain',
              )}
            />
          ) : (
            <span className="flex items-center gap-2 px-2 text-center text-xs text-muted-foreground">
              <ImageIcon aria-hidden="true" className="size-4 shrink-0" /> No {copy.noun} yet
            </span>
          )}
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShown(PAGE);
                setError('');
                setOpen(true);
              }}
            >
              {value ? `Change ${copy.noun}` : `Choose ${copy.noun}`}
            </Button>
            {value ? (
              <Button variant="ghost" onClick={() => onChange('')}>
                Remove {copy.noun}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
      {open ? (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!busy) setOpen(v);
          }}
        >
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Choose {copy.noun}</DialogTitle>
              <DialogDescription>
                Upload a new image, or pick one from this hotel’s photo library.
              </DialogDescription>
            </DialogHeader>
            <FormField htmlFor={`${kind}-upload`} label={`Upload a new ${copy.noun}`}>
              <div className="flex items-center gap-3">
                <Upload aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <Input
                  id={`${kind}-upload`}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                    e.target.value = '';
                  }}
                />
              </div>
              {busy ? (
                <p role="status" className="m-0 text-xs text-muted-foreground">
                  Uploading…
                </p>
              ) : null}
            </FormField>
            <div className="flex flex-col gap-2">
              <p className="m-0 text-sm font-semibold">Or choose from the photo library</p>
              {query.isPending ? (
                <p role="status" className="m-0 text-sm text-muted-foreground">
                  Loading photos…
                </p>
              ) : query.isError ? (
                <Alert>
                  <AlertDescription>Could not load photos. Check photo access.</AlertDescription>
                </Alert>
              ) : images.length === 0 ? (
                <p className="m-0 text-sm text-muted-foreground">
                  No photos yet. Upload an image above to get started.
                </p>
              ) : (
                <>
                  <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0 sm:grid-cols-4">
                    {images.slice(0, shown).map((image) => {
                      const selected = image.url === value;
                      return (
                        <li key={image.id}>
                          <button
                            type="button"
                            disabled={busy}
                            aria-pressed={selected}
                            onClick={() => select(image.url)}
                            className={cn(
                              'relative flex w-full flex-col gap-1 overflow-hidden rounded-lg border bg-card p-1 text-left transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50',
                              selected && 'border-primary ring-2 ring-primary',
                            )}
                          >
                            <span className="flex aspect-[4/3] w-full items-center justify-center">
                              <img
                                src={image.url}
                                alt=""
                                loading="lazy"
                                className="max-h-full max-w-full object-contain"
                              />
                            </span>
                            <span className="block truncate px-0.5 text-[11px] text-muted-foreground">
                              {image.originalName ?? 'Hotel photo'}
                            </span>
                            {selected ? (
                              <span className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
                                <Check aria-hidden="true" className="size-3" />
                              </span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {shown < images.length ? (
                    <Button variant="outline" size="sm" onClick={() => setShown(shown + PAGE)}>
                      Show more ({images.length - shown} left)
                    </Button>
                  ) : null}
                </>
              )}
            </div>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </FormField>
  );
}
