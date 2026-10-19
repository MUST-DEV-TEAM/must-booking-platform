import { Button } from '../../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { StatTile } from '../../components/ui/stat-tile';
import { DetailList } from '../../components/ui/detail-list';
import { EmptyPanel } from '../../components/ui/state-panel';
import type { EmailOverview } from '../../lib/email-workspace';
/** Actionable operational email evidence; no inferred provider authentication status. */
export function EmailHealthOverview({
  data,
  onDelivery,
  onConfiguration,
  onMessage,
}: {
  data: EmailOverview;
  onDelivery: (filter: string, topic?: string, hours?: number) => void;
  onConfiguration: () => void;
  onMessage: (id: string) => void;
}) {
  const rate = (v: number | null) =>
    v === null ? 'No attempts in this period' : `${v.toFixed(2)}%`;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Volume - last 24 hours"
          value={data.volume24h}
          onClick={() => onDelivery('all', undefined, 24)}
        />
        <StatTile
          label="Volume - last 7 days"
          value={data.volume7d}
          onClick={() => onDelivery('all', undefined, 168)}
        />
        <StatTile
          label="Bounce rate - 7 days"
          value={rate(data.bounceRate)}
          note="Bounced messages / attempted messages"
          onClick={() => onDelivery('bounced', undefined, 168)}
        />
        <StatTile
          label="Complaint rate - 7 days"
          value={rate(data.complaintRate)}
          note="Complained messages / attempted messages"
          onClick={() => onDelivery('complained', undefined, 168)}
        />
        <StatTile
          label="Queued / unsent"
          value={data.queued}
          note={
            data.oldestQueued
              ? `Oldest queued: ${new Date(data.oldestQueued).toLocaleString()}`
              : 'No queued messages'
          }
          onClick={() => onDelivery('queued')}
        />
        <StatTile
          label="Suppressed addresses"
          value={data.suppressedAddresses}
          onClick={onConfiguration}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>What to fix next</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {data.actionNeeded.length ? (
              data.actionNeeded.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b pb-3"
                >
                  <div className="min-w-0">
                    <p className="m-0 text-sm font-semibold">
                      {row.label} - {row.status.toLowerCase()}
                    </p>
                    <p className="m-0 text-sm text-muted-foreground">{row.recipient}</p>
                    {row.lastError ? (
                      <p className="m-0 text-sm text-muted-foreground">{row.lastError}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {row.lastError?.startsWith('Email sending is not configured.') ? (
                      <Button variant="outline" onClick={onConfiguration}>
                        Set up sending
                      </Button>
                    ) : null}
                    <Button variant="outline" onClick={() => onMessage(row.id)}>
                      Open delivery
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <EmptyPanel title="No deliveries need action" />
            )}
            <Button variant="outline" onClick={() => onDelivery('problems')}>
              Open all delivery problems
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sending domain</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <DetailList
              items={[
                { label: 'Sender', value: 'Default MUST sender' },
                {
                  label: 'Domain checks',
                  value: 'No provider domain check has been recorded for this hotel.',
                },
              ]}
            />
            <Button variant="outline" onClick={onConfiguration}>
              Set up sending and DNS records
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top failing topics - 7 days</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {data.failingTopics.length ? (
              data.failingTopics.map((row) => (
                <Button
                  key={row.topic}
                  variant="outline"
                  className="justify-between"
                  onClick={() => onDelivery('problems', row.topic)}
                >
                  <span>{row.label}</span>
                  <span>{row.count}</span>
                </Button>
              ))
            ) : (
              <EmptyPanel title="No failing topics in this period" />
            )}
          </CardContent>
        </Card>
      </div>
      <p className="m-0 text-sm text-muted-foreground">
        Controlled tests are excluded. Rates use each message's current stored outcome.
      </p>
    </>
  );
}
