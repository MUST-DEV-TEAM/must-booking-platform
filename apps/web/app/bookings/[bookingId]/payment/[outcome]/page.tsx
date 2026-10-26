'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import styles from './page.module.css';
export default function BookingPaymentOutcomePage() {
  const params = useParams<{ bookingId: string; outcome: string }>();
  const cancelled = params.outcome === 'cancel';
  const [paid, setPaid] = useState(false);
  const [brand, setBrand] = useState<{ name: string; logoUrl: string | null } | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const orderId = query.get('orderId');
    const abort = new AbortController();
    let loadedScope = '';
    const loadBrand = (tenantId: unknown, propertyId: unknown) => {
      if (
        typeof tenantId !== 'string' ||
        typeof propertyId !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(tenantId) ||
        !/^[0-9a-f-]{36}$/i.test(propertyId)
      )
        return;
      const scope = tenantId + ':' + propertyId;
      if (loadedScope === scope) return;
      loadedScope = scope;
      void fetch(`/api/tenants/${tenantId}/properties/${propertyId}/public/branding`, {
        signal: abort.signal,
      })
        .then(async (response) => {
          if (!response.ok) return;
          const value = await response.json();
          if (!abort.signal.aborted && typeof value.name === 'string') {
            setBrand({
              name: value.name,
              logoUrl:
                typeof value.logoUrl === 'string' && /^(https?:\/\/|\/(?!\/))/i.test(value.logoUrl)
                  ? value.logoUrl
                  : null,
            });
            setLogoFailed(false);
          }
        })
        .catch(() => {
          /* Hotel branding must not interrupt payment confirmation. */
        });
    };
    loadBrand(query.get('tenantId'), query.get('propertyId'));
    let channel: BroadcastChannel | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      channel = new BroadcastChannel('must-payment');
      channel.onmessage = (event) => {
        if (
          orderId &&
          event.data?.bookingId === params.bookingId &&
          event.data?.orderId === orderId &&
          event.data?.state === 'HOTEL_CONTEXT'
        )
          loadBrand(event.data.tenantId, event.data.propertyId);
        if (
          orderId &&
          event.data?.bookingId === params.bookingId &&
          event.data?.orderId === orderId &&
          ['PAID', 'CONFIRMED'].includes(event.data?.state)
        ) {
          setPaid(true);
          timer = setTimeout(() => window.close(), 1500);
        }
      };
      channel.postMessage({ bookingId: params.bookingId, orderId, outcome: params.outcome });
    } catch {
      /* Confirmation remains on the booking screen when browser messaging is unavailable. */
    }
    return () => {
      abort.abort();
      channel?.close();
      if (timer) clearTimeout(timer);
    };
  }, [params.bookingId, params.outcome]);
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="payment-title">
        <div className={styles.brand}>
          {brand?.logoUrl && !logoFailed ? (
            <img
              className={styles.logo}
              src={brand.logoUrl}
              alt={brand.name}
              onError={() => setLogoFailed(true)}
            />
          ) : (
            <span>{brand?.name ?? 'Your hotel'}</span>
          )}
        </div>
        <div aria-hidden="true" className={styles.symbol}>
          {paid ? (
            '✓'
          ) : cancelled ? (
            '—'
          ) : (
            <span className={styles.dots} data-testid="payment-checking-dots">
              <span />
              <span />
              <span />
            </span>
          )}
        </div>
        <h1 id="payment-title">
          {paid ? 'Payment received' : cancelled ? 'Checkout closed' : 'Checking your payment'}
        </h1>
        <p role="status">
          {paid
            ? 'Your payment has been confirmed. The booking screen will update automatically.'
            : cancelled
              ? 'Return to the booking to check its latest payment status before trying again.'
              : 'Your payment was submitted to PokPay. Keep the booking screen open while it confirms this payment.'}
        </p>
        <p className={styles.hint}>
          {paid
            ? 'This tab will close shortly. If your browser keeps it open, you can close it below.'
            : 'Returning from PokPay does not by itself confirm a successful payment.'}
        </p>
        <div className={styles.actions}>
          <button type="button" onClick={() => window.close()}>
            Close this tab
          </button>
          <a href="/dashboard">Open MUST</a>
        </div>
      </section>
    </main>
  );
}
