'use client';
import { useEffect } from 'react';
import { useParams } from 'next/navigation';
export default function BookingPaymentOutcomePage() {
  const params = useParams<{ bookingId: string; outcome: string }>();
  const cancelled = params.outcome === 'cancel';
  useEffect(() => {
    try {
      const channel = new BroadcastChannel('must-payment');
      channel.postMessage({ bookingId: params.bookingId, outcome: params.outcome });
      channel.close();
    } catch {
      /* The original booking screen also polls the verified result. */
    }
    window.close();
  }, [params.bookingId, params.outcome]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 px-6">
      <h1 className="text-2xl font-semibold">
        {cancelled ? 'Checkout closed' : 'Payment submitted'}
      </h1>
      <p>
        {cancelled
          ? 'Check the booking for the payment status before trying again.'
          : 'The booking screen checks the payment result automatically.'}
      </p>
      <p>
        You can close this tab. If it stayed open, your browser does not allow automatic closing.
      </p>
      <button className="self-start rounded-lg border px-4 py-2" onClick={() => window.close()}>
        Close this tab
      </button>
    </main>
  );
}
