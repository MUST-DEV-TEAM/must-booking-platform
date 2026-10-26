'use client';

import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { Alert, AlertDescription } from '../../../../../components/ui/alert';
import { Badge } from '../../../../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../components/ui/card';
import { PermissionPanel } from '../../../../../components/ui/permission-panel';
import { Skeleton } from '../../../../../components/ui/skeleton';
import { ErrorPanel } from '../../../../../components/ui/state-panel';
import {
  type ConnectionRow,
  ConsoleApiError,
  consoleGet,
  type HotelConnections,
  MODE_LABELS,
} from '../../../../../lib/platform-api';
import { formatAgo } from '../../../../../lib/platform-format';
import { useConsoleSession } from '../../console-frame';

const STATUS: Record<
  ConnectionRow['status'],
  { label: string; tone: 'success' | 'warning' | 'danger' }
> = {
  CONNECTED: { label: 'Connected', tone: 'success' },
  PENDING: { label: 'Not tested yet', tone: 'warning' },
  FAILED: { label: 'Failing', tone: 'danger' },
};

const PROVIDERS: Record<string, string> = {
  CLOCK_PMS: 'Clock PMS+',
  STRIPE: 'Stripe',
  POKPAY: 'PokPay',
};

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <span className="font-medium">{label}</span>
      <span className="flex flex-wrap items-center gap-2 text-muted-foreground">{children}</span>
    </div>
  );
}

function Connection({ row }: { row: ConnectionRow }) {
  const status = STATUS[row.status];
  return (
    <Row label={`${PROVIDERS[row.provider] ?? row.provider} · ${row.name}`}>
      <Badge variant={status.tone}>{status.label}</Badge>
      <span className="text-xs">
        Tested {formatAgo(row.lastTestedAt)}
        {row.lastWebhookReceivedAt ? ` · webhook ${formatAgo(row.lastWebhookReceivedAt)}` : ''}
      </span>
      {row.status === 'FAILED' && row.lastTestResult ? (
        <span className="w-full text-xs text-destructive">{row.lastTestResult}</span>
      ) : null}
    </Row>
  );
}

export function ConnectionsTab({ hotelId }: { hotelId: string }) {
  const { can } = useConsoleSession();
  const query = useQuery({
    queryKey: ['platform-console', 'connections', hotelId],
    queryFn: () => consoleGet<HotelConnections>(`/hotels/${hotelId}/connections`),
    enabled: can('platform.connections.view'),
  });
  if (!can('platform.connections.view')) return <PermissionPanel />;
  if (query.isLoading)
    return (
      <div className="space-y-4" role="status" aria-label="Loading connections">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  if (query.isError || !query.data)
    return (
      <ErrorPanel
        title="We couldn’t load the connections"
        reference={
          query.error instanceof ConsoleApiError ? (query.error.reference ?? undefined) : undefined
        }
        onRetry={() => void query.refetch()}
      />
    );

  const data = query.data;
  return (
    <div className="space-y-6">
      <Alert variant="info">
        <AlertDescription>
          Status only. Connections are managed by the hotel; no credentials are shown or stored
          here.
        </AlertDescription>
      </Alert>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>PMS and inventory</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            <Row label="Mode">
              <Badge variant="outline">{MODE_LABELS[data.mode]}</Badge>
            </Row>
            {data.pms.length > 0 ? (
              data.pms.map((row) => <Connection key={row.id} row={row} />)
            ) : (
              <Row label={data.mode === 'CLOCK' ? 'Clock PMS+' : 'Built-in inventory'}>
                <Badge variant={data.mode === 'CLOCK' ? 'warning' : 'muted'}>
                  {data.mode === 'CLOCK' ? 'No Clock connection yet' : 'Managed in MUST'}
                </Badge>
              </Row>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment gateways</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {data.payments.gateways.length === 0 ? (
              <Row label="Gateways">
                <Badge variant="warning">None connected</Badge>
              </Row>
            ) : (
              data.payments.gateways.map((row) => <Connection key={row.id} row={row} />)
            )}
            {data.payments.properties.map((property) => (
              <Row key={property.propertyId} label={`${property.propertyName} accepts`}>
                {property.stripeEnabled ? <Badge variant="info">Stripe</Badge> : null}
                {property.pokpayEnabled ? <Badge variant="info">PokPay</Badge> : null}
                {property.payAtHotelEnabled ? <Badge variant="info">Pay at hotel</Badge> : null}
                {!property.stripeEnabled &&
                !property.pokpayEnabled &&
                !property.payAtHotelEnabled ? (
                  <Badge variant="muted">No payment method on</Badge>
                ) : null}
              </Row>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Website</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {data.website.map((site) => (
              <Row key={site.propertyId} label={site.propertyName}>
                {site.pluginConnectedAt ? (
                  <Badge variant="success">
                    Plugin connected {formatAgo(site.pluginConnectedAt)}
                  </Badge>
                ) : (
                  <Badge variant="warning">Plugin not connected</Badge>
                )}
                <span className="text-xs">{site.origin ?? 'No website address'}</span>
              </Row>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Email sending</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            <Row label="Last 30 days">
              <Badge variant="success">{data.email.last30Days.delivered} sent</Badge>
              <Badge variant={data.email.last30Days.failed > 0 ? 'danger' : 'muted'}>
                {data.email.last30Days.failed} failed
              </Badge>
              <Badge variant="muted">{data.email.last30Days.queued} queued</Badge>
            </Row>
            <Row label="Last activity">{formatAgo(data.email.lastActivityAt)}</Row>
            {data.email.senders.map((sender) => (
              <Row key={sender.propertyId} label={`${sender.propertyName} sender`}>
                {sender.senderName ?? 'Default sender'}
                {sender.replyTo ? ` · replies to ${sender.replyTo}` : ''}
              </Row>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
