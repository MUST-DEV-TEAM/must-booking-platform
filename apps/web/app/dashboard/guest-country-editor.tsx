'use client';
import { useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CountrySelect } from '../../components/ui/country-select';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { createInventoryWriter } from './inventory-api';
/** Versioned local contact metadata only; never sends a guest update to a PMS. */
export function GuestCountryEditor({
  base,
  id,
  country,
  version,
  onClose,
}: {
  base: string;
  id: string;
  country: string | null;
  version: number;
  onClose: () => void;
}) {
  const [value, setValue] = useState(country);
  const writer = useRef(createInventoryWriter());
  const client = useQueryClient();
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Edit guest country"
      description="Country is optional, locally stored contact information shared by this guest profile."
      confirmLabel="Save country"
      onConfirm={async () => {
        await writer.current(`${base}/guests/${id}/country`, 'PATCH', {
          countryCode: value,
          version,
        });
        await client.invalidateQueries({ queryKey: ['dashboard'] });
        onClose();
      }}
    >
      <CountrySelect value={value} onChange={setValue} />
    </ConfirmDialog>
  );
}
