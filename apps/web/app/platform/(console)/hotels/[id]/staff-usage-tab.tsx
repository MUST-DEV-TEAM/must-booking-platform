'use client';

import { useQuery } from '@tanstack/react-query';

import { Badge } from '../../../../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../../components/ui/card';
import { PermissionPanel } from '../../../../../components/ui/permission-panel';
import { Progress } from '../../../../../components/ui/progress';
import { Skeleton } from '../../../../../components/ui/skeleton';
import { EmptyPanel, ErrorPanel } from '../../../../../components/ui/state-panel';
import { StatTile } from '../../../../../components/ui/stat-tile';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../../../components/ui/table';
import { ConsoleApiError, consoleGet, type StaffUsage } from '../../../../../lib/platform-api';
import { actionLabel, formatAgo, formatDateTime } from '../../../../../lib/platform-format';
import { useConsoleSession } from '../../console-frame';

export function StaffUsageTab({ hotelId }: { hotelId: string }) {
  const { can } = useConsoleSession();
  const query = useQuery({
    queryKey: ['platform-console', 'staff-usage', hotelId],
    queryFn: () => consoleGet<StaffUsage>(`/hotels/${hotelId}/staff-usage`),
    enabled: can('platform.hotels.view'),
  });
  if (!can('platform.hotels.view')) return <PermissionPanel />;
  if (query.isLoading)
    return (
      <div className="space-y-4" role="status" aria-label="Loading staff and usage">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (query.isError || !query.data)
    return (
      <ErrorPanel
        title="We couldn’t load staff and usage"
        reference={
          query.error instanceof ConsoleApiError ? (query.error.reference ?? undefined) : undefined
        }
        onRetry={() => void query.refetch()}
      />
    );

  const { staff, usage, recentHotelEvents } = query.data;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Bookings, all time" value={usage.bookingsTotal} />
        <StatTile
          label="Bookings, last 30 days"
          value={usage.bookingsLast30Days}
          note={`${usage.liveBookingsLast30Days} live`}
        />
        {usage.paymentsLast30Days.length === 0 ? (
          <StatTile label="Payments, last 30 days" value="None" size="sm" />
        ) : (
          usage.paymentsLast30Days.map((row) => (
            <StatTile
              key={row.currency}
              label={`Payments, last 30 days (${row.currency})`}
              value={Number(row.amount).toLocaleString('en-GB', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
              note={`${row.count} payments`}
            />
          ))
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Usage against plan limits</CardTitle>
          <p className="m-0 text-sm text-muted-foreground">{usage.limitsNote}</p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {usage.limits.map((limit) => (
            <div key={limit.key} className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="font-medium">{limit.label}</span>
                <span className="text-muted-foreground tabular-nums">
                  {limit.used} of {limit.limit}
                </span>
              </div>
              <Progress
                aria-label={`${limit.label} used`}
                value={Math.min(
                  100,
                  limit.limit > 0 ? Math.round((limit.used / limit.limit) * 100) : 0,
                )}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="gap-0 py-0">
        <CardHeader className="pt-5">
          <CardTitle>Staff</CardTitle>
        </CardHeader>
        {staff.length === 0 ? (
          <div className="p-4">
            <EmptyPanel
              title="No staff yet"
              description="The owner has not accepted the invitation."
            />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Access</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last login</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {staff.map((member) => (
                <TableRow key={member.userId}>
                  <TableCell>
                    <span className="font-semibold">{member.name ?? member.email}</span>
                    {member.name ? (
                      <span className="block text-xs text-muted-foreground">{member.email}</span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {member.membership === 'OWNER' ? (
                      <Badge variant="info">Owner</Badge>
                    ) : member.membership === 'ADMIN' ? (
                      <Badge variant="info">Admin</Badge>
                    ) : (
                      member.roles.join(', ') || 'Staff'
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={member.suspended ? 'danger' : 'success'}>
                      {member.suspended ? 'Suspended' : 'Active'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatAgo(member.lastLoginAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent hotel activity</CardTitle>
        </CardHeader>
        <CardContent>
          {recentHotelEvents.length === 0 ? (
            <p className="m-0 text-sm text-muted-foreground">No activity recorded yet.</p>
          ) : (
            <ul className="m-0 list-none divide-y p-0">
              {recentHotelEvents.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                >
                  <span className="font-medium">{actionLabel(event.action)}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {event.actorType === 'PLATFORM_ADMIN' ? (
                      <Badge variant="warning">MUST support</Badge>
                    ) : null}
                    {formatDateTime(event.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
