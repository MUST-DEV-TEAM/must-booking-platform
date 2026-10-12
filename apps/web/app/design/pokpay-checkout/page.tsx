import Link from 'next/link';
import { ArrowLeft, CreditCard, Info } from 'lucide-react';

import { Badge } from '../_ui/badge';
import { Button } from '../_ui/button';
import { Card } from '../_ui/card';

export default async function PokPayCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ amount?: string; stay?: string; rooms?: string; roomType?: string }>;
}) {
  const params = await searchParams;
  const parsedAmount = Number(params.amount);
  const amount = Number.isFinite(parsedAmount) && parsedAmount >= 0 ? parsedAmount : 0;
  const parsedRoomCount = Number(params.rooms);
  const roomCount = Number.isInteger(parsedRoomCount) && parsedRoomCount > 0 ? parsedRoomCount : 1;
  const stay = params.stay?.slice(0, 100) || 'Reservation dates';
  const roomType = params.roomType?.slice(0, 100) || 'Selected room';
  const formattedAmount = new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(amount);

  return (
    <main className="min-h-screen px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b pb-5">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-xl border bg-card text-primary shadow-xs">
              <CreditCard aria-hidden="true" className="size-5" />
            </span>
            <div>
              <p className="font-bold">MUST Hotel</p>
              <p className="text-xs text-muted-foreground">Reservation payment</p>
            </div>
          </div>
          <Badge variant="info">PokPay checkout preview</Badge>
        </header>

        <div className="mx-auto mt-8 grid max-w-4xl gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
          <Card className="gap-5 p-5 sm:p-7">
            <div>
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Payment preview
              </p>
              <h1 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
                Review payment
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Review the amount and stay details before payment.
              </p>
            </div>

            <div className="rounded-xl border bg-muted/20 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold">Payment amount</p>
                  <p className="mt-1 text-xs text-muted-foreground">PokPay selected</p>
                </div>
                <p className="text-2xl font-extrabold tabular-nums">{formattedAmount}</p>
              </div>
              <div className="mt-4 flex items-start gap-2 border-t pt-4 text-sm text-muted-foreground">
                <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>PokPay is selected for this booking.</span>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-xl border bg-muted/20 p-4">
              <Info aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-semibold">Preview only</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This page displays the payment summary. It does not connect to PokPay or take a
                  payment.
                </p>
              </div>
            </div>

            <Button asChild variant="outline" className="self-start">
              <Link href="/design/overview">
                <ArrowLeft aria-hidden="true" />
                Return to quick booking
              </Link>
            </Button>
          </Card>

          <Card className="gap-4 p-5 sm:p-6">
            <div>
              <h2 className="font-bold">Payment summary</h2>
              <p className="mt-1 text-sm text-muted-foreground">MUST Hotel · PokPay</p>
            </div>
            <dl className="space-y-3 border-y py-4 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Dates</dt>
                <dd className="text-right font-medium">{stay}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Rooms</dt>
                <dd className="font-medium">{roomCount}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Room type</dt>
                <dd className="text-right font-medium">{roomType}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Payment amount</dt>
                <dd className="font-semibold tabular-nums">{formattedAmount}</dd>
              </div>
              <div className="flex justify-between gap-4 text-base font-bold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formattedAmount}</dd>
              </div>
            </dl>
            <p className="text-xs leading-5 text-muted-foreground">
              No payment has been started or recorded.
            </p>
          </Card>
        </div>
      </div>
    </main>
  );
}
