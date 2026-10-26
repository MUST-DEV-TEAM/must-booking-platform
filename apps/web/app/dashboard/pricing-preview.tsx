'use client';
import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { Combobox } from '../../components/ui/combobox';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardDescription,
} from '../../components/ui/card';
import { EmptyPanel } from '../../components/ui/state-panel';
import { PriceBreakdown } from '../../components/ui/price-breakdown';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { inventoryRequest } from './inventory-api';
import { priceDay, type PricingWorkspace, type PricingPreview } from './pricing-types';
type RateOffer = {
  rateId: string;
  name: string;
  label: string;
  mealNames: string[];
  total: { amount: string; currency: string };
};

const money = (value: { amount: string; currency: string }) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: value.currency }).format(
    Number(value.amount),
  );

/** The server's saved-state price explainer; provider results are labeled separately and never synthesized locally. */
export function PricingPreviewPanel({
  base,
  data,
  planId,
}: {
  base: string;
  data: PricingWorkspace;
  planId?: string;
}) {
  const [type, setType] = useState(data.roomTypes[0]?.id ?? ''),
    [plan, setPlan] = useState(
      planId ?? data.plans.find((p) => p.isFallback)?.id ?? data.plans[0]?.id ?? '',
    ),
    [room, setRoom] = useState(''),
    [start, setStart] = useState(priceDay(data.today, 1)),
    [end, setEnd] = useState(priceDay(data.today, 2)),
    [adults, setAdults] = useState('1'),
    [children, setChildren] = useState('0'),
    [channel, setChannel] = useState('staff'),
    [result, setResult] = useState<PricingPreview | null>(null),
    [offers, setOffers] = useState<RateOffer[] | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const dirty = () => {
    revision.current++;
    setResult(null);
    setOffers(null);
    setError('');
  };
  if (
    planId &&
    data.source === 'LOCAL' &&
    data.plans.find((p) => p.id === planId)?.lifecycle !== 'Active'
  )
    return (
      <EmptyPanel
        title="Activate this plan before quoting"
        description="Drafts and archived plans are excluded from customer totals. Configure base prices and review publication readiness first."
      />
    );
  if (
    !data.roomTypes.length ||
    (data.source === 'LOCAL' && !data.plans.some((p) => p.lifecycle === 'Active'))
  )
    return (
      <EmptyPanel
        title="Pricing setup required"
        description="Add a room type, save a rate plan, configure base prices and activate the plan before using the price explainer."
      />
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {data.source === 'CLOCK_PMS' ? 'Clock prices - managed in Clock' : 'Price explainer'}
        </CardTitle>
        <CardDescription>
          Saved configuration only. This checks pricing, not room availability or final booking
          eligibility.{' '}
          {data.source === 'CLOCK_PMS'
            ? 'No local substitute prices are shown. Loading prices uses the existing Clock read-only quote reader.'
            : 'Amounts are tax-inclusive customer totals. No stock is reserved.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <FormField label="Room type">
            <Combobox
              label="Price room type"
              value={type}
              options={data.roomTypes.map((t) => ({ value: t.id, label: t.name }))}
              onChange={(v) => {
                dirty();
                setType(v);
                setRoom('');
              }}
            />
          </FormField>
          {data.source === 'LOCAL' ? (
            <FormField label="Rate plan">
              <Combobox
                label="Price rate plan"
                value={plan}
                options={data.plans
                  .filter((p) => p.lifecycle === 'Active')
                  .map((p) => ({ value: p.id, label: p.name }))}
                onChange={(v) => {
                  dirty();
                  setPlan(v);
                }}
              />
            </FormField>
          ) : null}
          {data.source === 'LOCAL' && data.bookingMode !== 'ROOM_TYPE_ONLY' ? (
            <FormField label="Room override">
              <Combobox
                label="Price room"
                value={room}
                options={[
                  { value: '', label: 'No exact room' },
                  ...data.rooms
                    .filter((r) => r.roomTypeId === type)
                    .map((r) => ({ value: r.id, label: r.name })),
                ]}
                onChange={(v) => {
                  dirty();
                  setRoom(v);
                }}
              />
            </FormField>
          ) : null}
          <FormField label="Arrival" htmlFor="price-start">
            <Input
              id="price-start"
              type="date"
              value={start}
              onChange={(e) => {
                dirty();
                setStart(e.target.value);
              }}
            />
          </FormField>
          <FormField label="Departure (exclusive)" htmlFor="price-end">
            <Input
              id="price-end"
              type="date"
              value={end}
              onChange={(e) => {
                dirty();
                setEnd(e.target.value);
              }}
            />
          </FormField>
          <FormField label="Adults" htmlFor="price-adults">
            <Input
              id="price-adults"
              type="number"
              min={1}
              value={adults}
              onChange={(e) => {
                dirty();
                setAdults(e.target.value);
              }}
            />
          </FormField>
          <FormField label="Children" htmlFor="price-children">
            <Input
              id="price-children"
              type="number"
              min={0}
              value={children}
              onChange={(e) => {
                dirty();
                setChildren(e.target.value);
              }}
            />
          </FormField>
          <FormField label="Channel">
            <Combobox
              label="Price channel"
              value={channel}
              options={[
                { value: 'staff', label: 'Staff' },
                { value: 'website', label: 'Website' },
              ]}
              onChange={(v) => {
                dirty();
                setChannel(v);
              }}
            />
          </FormField>
        </div>
        <Button
          disabled={busy || !type || (data.source === 'LOCAL' && !plan)}
          loading={busy}
          onClick={async () => {
            const current = ++revision.current;
            setBusy(true);
            setError('');
            setResult(null);
            setOffers(null);
            if (data.source === 'CLOCK_PMS') {
              // Every bookable rate for this stay, so the price of each can be compared. Staff-only: a
              // refusal (no booking rights) simply leaves the list out.
              const staffBase = base.replace(/\/pricing$/, '');
              void inventoryRequest<{ offers: RateOffer[] }>(
                `${staffBase}/staff-bookings/rate-offers`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    roomTypeId: type,
                    startsOn: start,
                    endsOn: end,
                    adults: Number(adults),
                    children: Number(children),
                    childrenAges: [],
                  }),
                },
              )
                .then((next) => {
                  if (current === revision.current) setOffers(next.offers);
                })
                .catch(() => undefined);
            }
            try {
              const next = await inventoryRequest<PricingPreview>(`${base}/preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  roomTypeId: type,
                  ratePlanId: plan || undefined,
                  roomId: room || undefined,
                  startsOn: start,
                  endsOn: end,
                  adults: Number(adults),
                  children: Number(children),
                  channel,
                }),
              });
              if (current === revision.current) setResult(next);
            } catch (e) {
              if (current === revision.current)
                setError(e instanceof Error ? e.message : 'Price could not be loaded.');
            } finally {
              setBusy(false);
            }
          }}
        >
          {data.source === 'CLOCK_PMS' ? 'Check selected stay price' : 'Explain price'}
        </Button>
        {error || (result && !result.valid) ? (
          <Alert variant="destructive">
            <AlertTitle>Price could not be verified</AlertTitle>
            <AlertDescription>
              {error ||
                result?.errors.map((e) => `${e.date ? e.date + ': ' : ''}${e.message}`).join(' ')}
            </AlertDescription>
          </Alert>
        ) : null}
        {offers ? (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-sm font-semibold">Every rate for this stay</p>
            {offers.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rate</TableHead>
                    <TableHead>Total for the stay</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {offers.map((offer) => (
                    <TableRow key={offer.rateId}>
                      <TableCell>
                        {offer.label}
                        {offer.label !== offer.name ? (
                          <span className="text-muted-foreground"> · {offer.name}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>{money(offer.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="m-0 text-sm text-muted-foreground">
                No rate can be booked for these dates. Check availability and the rate setup in
                Clock.
              </p>
            )}
            <p className="m-0 text-xs text-muted-foreground">
              Cheapest first. Guests see the same list.
            </p>
          </div>
        ) : null}
        {result?.valid ? (
          <PriceBreakdown value={result} />
        ) : !result && data.source === 'CLOCK_PMS' ? (
          <Alert>
            <AlertTitle>Provider price: Unknown</AlertTitle>
            <AlertDescription>
              Choose a stay and load Clock prices. No local price is substituted when the provider
              is unavailable.
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
