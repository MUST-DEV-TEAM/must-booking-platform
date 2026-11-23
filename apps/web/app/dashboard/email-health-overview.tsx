import { formatDateTime } from '../../lib/hotel-format';
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
  onBlocked,
  onSending,
  onMessage,
}: {
  data: EmailOverview;
  onDelivery: (filter: string, topic?: string, hours?: number) => void;
  /** Shows the blocked addresses (the suppression list). */
  onBlocked: () => void;
  /** Where a sender problem is fixed. */
  onSending: () => void;
  onMessage: (id: string) => void;
}) {
  const rate = (v: number | null) =>
    v === null ? 'No attempts in this period' : `${v.toFixed(2)}%`;
  const senderNames: Record<string, string> = {
    DEFAULT: 'Default MUST sender',
    RESEND: 'Own domain through Resend',
    SMTP: 'Custom SMTP',
    BREVO: 'Own Brevo account',
  };
  const domain = data.domainEvidence;
  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Sent, last 24 hours"
          value={data.volume24h}
          note={`${data.volume7d} in the last 7 days`}
          onClick={() => onDelivery('all', undefined, 24)}
        />
        <StatTile
          label="Bounce rate, 7 days"
          value={rate(data.bounceRate)}
          note="Bounced messages / attempted messages"
          onClick={() => onDelivery('bounced', undefined, 168)}
        />
        <StatTile
          label="Complaint rate, 7 days"
          value={rate(data.complaintRate)}
          note="Complained messages / attempted messages"
          onClick={() => onDelivery('complained', undefined, 168)}
        />
        <StatTile
          label="Queued or unsent"
          value={data.queued}
          note={
            data.oldestQueued
              ? `Oldest queued: ${formatDateTime(data.oldestQueued)}`
              : 'No queued messages'
          }
          onClick={() => onDelivery('queued')}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:h-full">
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
                      <Button variant="outline" onClick={onSending}>
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
            {data.failingTopics.length ? (
              <div className="flex flex-col gap-2">
                <p className="m-0 text-sm font-semibold">Most problems, last 7 days</p>
                <div className="flex flex-wrap gap-2">
                  {data.failingTopics.map((row) => (
                    <Button
                      key={row.topic}
                      size="sm"
                      variant="outline"
                      onClick={() => onDelivery('problems', row.topic)}
                    >
                      {row.label} · {row.count}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            <Button variant="outline" className="self-start" onClick={() => onDelivery('problems')}>
              Open all delivery problems
            </Button>
            <Button variant="outline" className="self-start" onClick={onBlocked}>
              Blocked addresses ({data.suppressedAddresses})
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
                {
                  label: 'Current sender',
                  value: senderNames[domain?.activeMode ?? 'DEFAULT'] ?? 'No recorded sender',
                },
                ...(domain
                  ? [
                      {
                        label: 'Saved setup',
                        value: senderNames[domain.setupMode] ?? 'No saved setup',
                      },
                    ]
                  : []),
                {
                  label: 'Domain checks',
                  value: domain?.checkedAt
                    ? `${domain.setupMode === 'RESEND' && domain.activeMode !== 'RESEND' ? 'Saved custom domain (not active): ' : ''}${domain.status === 'verified' ? 'provider verified' : domain.status === 'pending' ? 'DNS pending' : domain.status === 'not_found' ? 'domain not found' : 'check needs attention'}`
                    : domain?.setupMode === 'SMTP' || domain?.setupMode === 'BREVO'
                      ? 'Use the connection and mailbox checks under Sending.'
                      : 'No provider domain check has been recorded for this hotel.',
                },
                ...(domain?.checkedAt
                  ? [
                      {
                        label: 'Last checked',
                        value: formatDateTime(domain.checkedAt, 'medium'),
                      },
                      { label: 'SPF', value: domain.spf },
                      { label: 'DKIM', value: domain.dkim },
                      { label: 'DMARC', value: domain.dmarc },
                    ]
                  : []),
              ]}
            />
            <Button variant="outline" className="self-start" onClick={onSending}>
              Open Sending
            </Button>
          </CardContent>
        </Card>
      </div>
      <p className="m-0 text-xs text-muted-foreground">
        Controlled tests are excluded. Rates use each message's current stored outcome.
      </p>
    </div>
  );
}
