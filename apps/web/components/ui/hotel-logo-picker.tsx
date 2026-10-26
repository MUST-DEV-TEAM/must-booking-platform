'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from './button';
import { Input } from './input';
import { FormField } from './form-field';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './dialog';
import { Alert, AlertDescription } from './alert';
import {
  libraryUrl,
  libraryQueryKey,
  uploadToLibrary,
  validateImageFile,
  type LibraryImage,
} from '../../app/dashboard/[tenantId]/property-image-library';
export function HotelLogoPicker({
  tenantId,
  propertyId,
  value,
  onChange,
  canManage,
}: {
  tenantId: string;
  propertyId: string;
  value: string;
  onChange: (url: string) => void;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
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
    let stored = false;
    try {
      const parsed = new URL(url);
      const key = parsed.searchParams.get('key') ?? '';
      stored =
        (parsed.protocol === 'https:' || parsed.origin === window.location.origin) &&
        parsed.pathname.endsWith('/media/image') &&
        key.startsWith(`server-v1/library/${tenantId}/${propertyId}/`) &&
        /\.(png|jpe?g|webp)$/i.test(key);
    } catch {
      /* Optional browser capability unavailable; keep the normal UI path. */
    }
    if (!stored && (!/^https:\/\//i.test(url) || !/\.(png|jpe?g|webp)(?:[?#]|$)/i.test(url))) {
      setError('Choose a public https PNG, JPG or WebP image.');
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
        throw new Error('The uploaded logo is not ready. Try choosing it from the library again.');
      select(image.url);
    } catch {
      setError('Could not upload this logo. Check photo access and try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormField
      label="Hotel logo"
      hint="PNG, JPG or WebP, up to 10 MB. Used in the sidebar and booking emails."
    >
      {value ? (
        <img src={value} alt="Current hotel logo" className="max-h-16 max-w-48 object-contain" />
      ) : null}
      {canManage ? (
        <>
          <Button variant="outline" onClick={() => setOpen(true)}>
            Choose logo
          </Button>
          {value ? (
            <Button variant="ghost" onClick={() => onChange('')}>
              Remove logo
            </Button>
          ) : null}
        </>
      ) : null}
      {open ? (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!busy) setOpen(v);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Choose hotel logo</DialogTitle>
            </DialogHeader>
            <FormField htmlFor="logo-upload" label="Upload logo">
              <Input
                id="logo-upload"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = '';
                }}
              />
            </FormField>
            {query.isPending ? (
              <p role="status">Loading photos...</p>
            ) : query.isError ? (
              <Alert>
                <AlertDescription>Could not load photos. Check photo access.</AlertDescription>
              </Alert>
            ) : query.data.length === 0 ? (
              <p>No photos yet. Upload a logo to get started.</p>
            ) : (
              query.data.map((image) => (
                <Button
                  variant="outline"
                  key={image.id}
                  disabled={busy}
                  onClick={() => select(image.url)}
                >
                  <img src={image.url} alt="" className="h-10 w-10 object-contain" />
                  {image.originalName ?? 'Hotel photo'}
                </Button>
              ))
            )}
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
