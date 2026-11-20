'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImageIcon } from 'lucide-react';
import { Button } from './button';
import { FormField } from './form-field';
import { Alert, AlertDescription } from './alert';
import { cn } from '../../lib/utils';
import {
  libraryUrl,
  libraryQueryKey,
  PropertyImageLibraryDialog,
  type LibraryImage,
} from '../../app/dashboard/[tenantId]/property-image-library';

const IMAGE_EXTENSION = /\.(png|jpe?g|webp)(?:[?#]|$)/i;

/** A logo must be reachable by email apps and browsers: a full https link, or a path on this site. */
function usableLogoUrl(url: string): boolean {
  if (!IMAGE_EXTENSION.test(url)) return false;
  if (/^https:\/\//i.test(url) || /^\/(?!\/)/.test(url)) return true;
  // Local development serves photos from http://localhost; production builds never accept it.
  return (
    process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)[:/]/i.test(url)
  );
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
    wordless: true,
  },
  favicon: {
    label: 'Favicon',
    noun: 'favicon',
    hint: 'The small image in the browser tab. Made from the square icon unless you choose another.',
    box: 'size-24 rounded-2xl',
    fit: 'object-cover',
    wordless: true,
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
    [error, setError] = useState('');
  const client = useQueryClient();
  /** Looks the chosen library photo up (refreshing the list if it was only just uploaded) and uses its address. */
  async function choose(id: string | undefined) {
    if (!id) return;
    const key = libraryQueryKey(tenantId, propertyId);
    let image = client.getQueryData<LibraryImage[]>(key)?.find((i) => i.id === id);
    if (!image) {
      const response = await fetch(libraryUrl(tenantId, propertyId), { credentials: 'include' });
      if (response.ok) {
        const images = (await response.json()) as LibraryImage[];
        client.setQueryData(key, images);
        image = images.find((i) => i.id === id);
      }
    }
    if (!image) {
      setError('That photo is not ready yet. Try choosing it again.');
      return;
    }
    if (!usableLogoUrl(image.url)) {
      setError('Choose a PNG, JPG or WebP image that is reachable from the internet.');
      return;
    }
    setError('');
    setOpen(false);
    onChange(image.url);
  }
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
              <ImageIcon
                aria-hidden="true"
                className={cn('shrink-0', 'wordless' in copy ? 'size-6' : 'size-4')}
              />
              {'wordless' in copy ? (
                <span className="sr-only">No {copy.noun} yet</span>
              ) : (
                <>No {copy.noun} yet</>
              )}
            </span>
          )}
        </div>
        {canManage ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
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
        <PropertyImageLibraryDialog
          tenantId={tenantId}
          propertyId={propertyId}
          mode="single"
          title={`Choose ${copy.noun}`}
          confirmLabel={`Use this ${copy.noun}`}
          onConfirm={(ids) => void choose(ids[0])}
          onClose={() => setOpen(false)}
        />
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
    </FormField>
  );
}
