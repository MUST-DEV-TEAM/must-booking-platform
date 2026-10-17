'use client';

import { Activity, ArrowUpRight, CircleAlert, CircleCheck } from 'lucide-react';

import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { EmptyPanel } from '../../../components/ui/state-panel';
import type { AccommodationActivity, RoomType } from './room-management-types';

type ReadinessKey = NonNullable<RoomType['readiness']>['checks'][number]['key'];

/** Setup readiness and recent accommodation audit events for the selected property. */
export function AccommodationOverview({
  roomTypes,
  activity,
  canFix,
  onFix,
}: {
  roomTypes: RoomType[];
  activity: AccommodationActivity[];
  canFix: (key: ReadinessKey) => boolean;
  onFix: (roomType: RoomType, key: ReadinessKey) => void;
}) {
  const readyCount = roomTypes.filter((roomType) => roomType.readiness?.isComplete).length;
  const needsAttention = roomTypes.filter(
    (roomType) => roomType.readiness && !roomType.readiness.isComplete,
  );

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Setup readiness</CardTitle>
          <CardDescription>
            {roomTypes.length
              ? `${readyCount} of ${roomTypes.length} room types meet the setup checks.`
              : 'Add a room type to begin setup.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={readyCount === roomTypes.length && roomTypes.length ? 'success' : 'muted'}
            >
              {readyCount} complete
            </Badge>
            <Badge variant={needsAttention.length ? 'warning' : 'success'}>
              {needsAttention.length} need attention
            </Badge>
          </div>
          {needsAttention.length ? (
            <div className="flex flex-col gap-2">
              {needsAttention.map((roomType) => {
                const firstFix = roomType.readiness?.firstFix;
                const check = roomType.readiness?.checks.find((item) => item.key === firstFix?.key);
                const canFixThis = firstFix ? canFix(firstFix.key as ReadinessKey) : false;
                return (
                  <div
                    key={roomType.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
                  >
                    <div className="flex min-w-0 items-start gap-2">
                      <CircleAlert
                        className="mt-0.5 size-4 shrink-0 text-warning"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="m-0 truncate text-sm font-semibold">{roomType.name}</p>
                        <p className="m-0 mt-0.5 text-xs text-muted-foreground">
                          {roomType.readiness?.missingCount} missing · First: {firstFix?.label}
                        </p>
                      </div>
                    </div>
                    {firstFix ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canFixThis}
                        title={!canFixThis ? 'Your access does not allow this change.' : undefined}
                        onClick={() => onFix(roomType, firstFix.key as ReadinessKey)}
                      >
                        {check?.fixLabel ?? firstFix.label} <ArrowUpRight aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : roomTypes.length ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleCheck className="size-4 text-success" aria-hidden="true" /> All room types are
              ready.
            </div>
          ) : (
            <EmptyPanel
              title="No room types yet"
              description="Create a room type to see its setup checklist here."
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-4" aria-hidden="true" /> Recent activity
          </CardTitle>
          <CardDescription>
            Recent room, publication, and photo changes for this property.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {activity.length ? (
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {activity.slice(0, 8).map((event) => (
                <li
                  key={event.id}
                  className="flex items-start justify-between gap-4 border-b pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="m-0 text-sm font-medium">{activityLabel(event.action)}</p>
                    <p className="m-0 mt-1 truncate text-xs text-muted-foreground">
                      {event.actorName || 'Unknown user'} · {event.targetType.replaceAll('_', ' ')}
                    </p>
                  </div>
                  <time
                    className="shrink-0 text-xs text-muted-foreground"
                    dateTime={event.createdAt}
                  >
                    {formatActivityTime(event.createdAt)}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className="size-4" aria-hidden="true" /> No recent accommodation changes.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function activityLabel(action: string): string {
  const labels: Record<string, string> = {
    'room_type.created': 'Created a room type',
    'room_type.updated': 'Updated a room type',
    'room_type.deleted': 'Deleted a room type',
    'room_type.status_changed': 'Changed publication status',
    'room.created': 'Added a room',
    'room.updated': 'Updated a room',
    'room.deleted': 'Deleted a room',
    'room.active_changed': 'Changed room availability',
    'room_category.created': 'Added a category',
    'room_category.updated': 'Updated a category',
    'room_category.deleted': 'Deleted a category',
    'room_category.reordered': 'Reordered categories',
  };
  if (labels[action]) return labels[action];
  if (action.startsWith('room_type_image') || action.startsWith('room_type_images'))
    return 'Changed room type photos';
  if (action === 'accommodation.imported') return 'Imported accommodation data';
  return action.replaceAll('.', ' ').replaceAll('_', ' ');
}

function formatActivityTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unknown time'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
