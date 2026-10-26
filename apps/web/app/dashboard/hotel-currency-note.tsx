'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';

type HotelCurrency = {
  currency: string;
  source: 'setting' | 'clock' | 'default';
  setting: string | null;
  clock: string | null;
  mismatch: boolean;
};

/** Says which currency bookings, payments and refunds use for this hotel, and where that comes from. */
export function HotelCurrencyNote({
  propertyId,
  refreshKey,
}: {
  propertyId: string;
  refreshKey?: string;
}) {
  const params = useParams<{ tenantId?: string }>();
  const tenantId = params?.tenantId;
  const [info, setInfo] = useState<HotelCurrency | null>(null);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    void fetch(`/api/tenants/${tenantId}/properties/${propertyId}/currency`, {
      credentials: 'include',
    })
      .then((response) => (response.ok ? (response.json() as Promise<HotelCurrency>) : null))
      .then((body) => {
        if (!cancelled) setInfo(body);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [tenantId, propertyId, refreshKey]);

  if (!info) return null;
  if (info.mismatch)
    return (
      <Alert variant="warning">
        <AlertTitle>Currency does not match Clock</AlertTitle>
        <AlertDescription>
          Your setting is {info.setting}, but the rates in Clock are in {info.clock}. Prices from
          Clock stay in {info.clock}, so guests would see a different currency from the one set
          here. Change the setting to {info.clock}, or ask Clock to publish rates in {info.setting}.
        </AlertDescription>
      </Alert>
    );
  return (
    <p className="m-0 text-sm text-muted-foreground">
      Hotel currency: <strong>{info.currency}</strong>
      {info.source === 'setting'
        ? ' (set here).'
        : info.source === 'clock'
          ? ' (taken from your Clock rates; choose one above to set it yourself).'
          : ' (no currency chosen yet, so euro is used).'}{' '}
      Bookings, payments and refunds always use it. Other currencies on the website are only an
      approximate display.
    </p>
  );
}
