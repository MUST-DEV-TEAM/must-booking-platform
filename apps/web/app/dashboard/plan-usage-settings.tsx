'use client';

import { Badge } from '../../components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { Progress } from '../../components/ui/progress';

/** What `GET /tenants/:id/plan-usage` returns. */
export type PlanUsageData = {
  plan: {
    name: string;
    maxProperties: number;
    maxStaffSeats: number;
    pmsEnabled: boolean;
    maxPmsConnectionsPerProperty: number;
    readOnly: boolean;
    diningEnabled: boolean;
    maxVenues: number | null;
  };
  usage: { properties: number; staffSeats: number; venues: number };
};

/** A limit this large is "no limit" in practice (the single unlimited plan, issue #543). */
const UNLIMITED_FROM = 1000;
const isUnlimited = (limit: number | null | undefined) =>
  typeof limit !== 'number' || limit >= UNLIMITED_FROM;

function Meter({
  label,
  used,
  limit,
  full,
}: {
  label: string;
  used: number;
  limit: number | null | undefined;
  /** What happens when the limit is reached, in plain words. */
  full: string;
}) {
  const unlimited = isUnlimited(limit);
  const share = unlimited || !limit ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const atLimit = !unlimited && !!limit && used >= limit;
  const nearLimit = !unlimited && share >= 80;
  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {unlimited ? `${used} · No limit` : `${used} of ${limit}`}
        </span>
      </div>
      {unlimited ? null : (
        <Progress
          value={share}
          aria-label={`${label} used`}
          className={nearLimit ? '[&>div]:bg-warning' : undefined}
        />
      )}
      {atLimit ? (
        <p className="m-0 text-xs text-warning">{full} Nothing you already have is deleted.</p>
      ) : nearLimit ? (
        <p className="m-0 text-xs text-muted-foreground">You are close to the limit.</p>
      ) : null}
    </li>
  );
}

/**
 * Settings, Plan and usage: the plan in plain words, how much of it is in use, and what this hotel
 * uses. Changing the plan is handled by MUST for now (real plans and billing are issue #543).
 */
export function PlanUsageSettings({
  data,
  hotel,
}: {
  data: PlanUsageData | null;
  hotel: { rooms?: number; staff?: number };
}) {
  if (!data)
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          The plan could not be loaded.
        </CardContent>
      </Card>
    );
  const { plan } = data;
  const usage = {
    properties: data.usage?.properties ?? 0,
    staffSeats: data.usage?.staffSeats ?? 0,
    venues: data.usage?.venues ?? 0,
  };
  const status = plan.readOnly ? 'Read-only' : 'Active';
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:h-full">
        <Card>
          <CardHeader>
            <CardTitle>Your plan</CardTitle>
            <CardDescription>The plan covers all the hotels of your account.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xl font-semibold">{plan.name}</span>
              <Badge variant={plan.readOnly ? 'warning' : 'success'}>{status}</Badge>
            </div>
            {plan.readOnly ? (
              <p className="m-0 text-sm text-warning">
                This plan is read-only. You can look at everything, but nothing can be changed until
                the plan is active again.
              </p>
            ) : null}
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
              <li>
                Hotels:{' '}
                {isUnlimited(plan.maxProperties) ? 'no limit' : `up to ${plan.maxProperties}`}
              </li>
              <li>
                Staff accounts:{' '}
                {isUnlimited(plan.maxStaffSeats) ? 'no limit' : `up to ${plan.maxStaffSeats}`}
              </li>
              <li>
                Property system connection (PMS):{' '}
                {plan.pmsEnabled
                  ? isUnlimited(plan.maxPmsConnectionsPerProperty)
                    ? 'included'
                    : `included, up to ${plan.maxPmsConnectionsPerProperty} per hotel`
                  : 'not included'}
              </li>
              <li>
                Restaurants:{' '}
                {plan.diningEnabled
                  ? isUnlimited(plan.maxVenues)
                    ? 'included, no limit'
                    : `included, up to ${plan.maxVenues}`
                  : 'not included'}
              </li>
            </ul>
            <p className="m-0 text-sm text-muted-foreground">
              To change your plan or ask about billing, contact MUST. Online plan changes and
              invoices are not available yet.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Usage</CardTitle>
            <CardDescription>What your whole account uses today.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="m-0 flex list-none flex-col gap-5 p-0">
              <Meter
                label="Hotels"
                used={usage.properties}
                limit={plan.maxProperties}
                full="You cannot add another hotel."
              />
              <Meter
                label="Staff accounts"
                used={usage.staffSeats}
                limit={plan.maxStaffSeats}
                full="You cannot add another staff account."
              />
              {plan.diningEnabled ? (
                <Meter
                  label="Restaurants"
                  used={usage.venues}
                  limit={plan.maxVenues}
                  full="You cannot switch on another restaurant."
                />
              ) : null}
            </ul>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>This hotel</CardTitle>
          <CardDescription>What the hotel you are editing uses.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="m-0 grid grid-cols-2 gap-4 text-sm sm:max-w-md">
            <div>
              <dt className="text-muted-foreground">Rooms</dt>
              <dd className="m-0 text-xl font-semibold">{hotel.rooms ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Staff</dt>
              <dd className="m-0 text-xl font-semibold">{hotel.staff ?? '—'}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
