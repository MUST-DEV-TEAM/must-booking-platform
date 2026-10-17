'use client';

import { Activity, ArrowUpRight, CircleAlert, CircleCheck } from 'lucide-react';
import { useState } from 'react';

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
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip';
import {
  activitySentence,
  formatActivityDate,
  formatRelativeActivityTime,
  groupActivityEvents,
} from './accommodation-activity';
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
  const [showAllReadyTypes, setShowAllReadyTypes] = useState(false);
  const [activityLimit, setActivityLimit] = useState(8);
  const readyCount = roomTypes.filter((roomType) => roomType.readiness?.isComplete).length;
  const needsAttention = roomTypes.filter(
    (roomType) => roomType.readiness && !roomType.readiness.isComplete,
  );
  const allReady = roomTypes.length > 0 && readyCount === roomTypes.length;
  const sortedRoomTypes = [...roomTypes].sort((left, right) => {
    const leftComplete = left.readiness?.isComplete === true;
    const rightComplete = right.readiness?.isComplete === true;
    if (leftComplete !== rightComplete) return leftComplete ? 1 : -1;
    const missingDifference =
      (right.readiness?.missingCount ?? 0) - (left.readiness?.missingCount ?? 0);
    return missingDifference || left.name.localeCompare(right.name);
  });
  const groupedActivity = groupActivityEvents(activity);

  return (
    <div className="grid items-stretch gap-4 xl:grid-cols-2">
      <Card className="flex h-full min-w-0 flex-col">
        <CardHeader>
          <CardTitle>Setup readiness</CardTitle>
          <CardDescription>
            {roomTypes.length
              ? `${readyCount} of ${roomTypes.length} room types meet the setup checks.`
              : 'Add a room type to begin setup.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-3">
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
          {roomTypes.length ? (
            <>
              {allReady ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-success/10 px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <CircleCheck className="size-4 text-success" aria-hidden="true" /> All room
                    types are ready.
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={showAllReadyTypes}
                    onClick={() => setShowAllReadyTypes((value) => !value)}
                  >
                    {showAllReadyTypes ? 'Hide' : 'Show all'}
                  </Button>
                </div>
              ) : null}
              {!allReady || showAllReadyTypes ? (
                <div className="flex flex-col gap-2">
                  {sortedRoomTypes.map((roomType) => {
                    const complete = roomType.readiness?.isComplete === true;
                    const missingCount = roomType.readiness?.missingCount ?? 0;
                    const firstFix = complete ? null : roomType.readiness?.firstFix;
                    const check = roomType.readiness?.checks.find(
                      (item) => item.key === firstFix?.key,
                    );
                    const canFixThis = firstFix ? canFix(firstFix.key as ReadinessKey) : false;
                    return (
                      <div
                        key={roomType.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
                      >
                        <div className="flex min-w-0 items-start gap-2">
                          {complete ? (
                            <CircleCheck
                              className="mt-0.5 size-4 shrink-0 text-success"
                              aria-hidden="true"
                            />
                          ) : (
                            <CircleAlert
                              className="mt-0.5 size-4 shrink-0 text-warning"
                              aria-hidden="true"
                            />
                          )}
                          <div className="min-w-0">
                            <p className="m-0 truncate text-sm font-semibold">{roomType.name}</p>
                            <p className="m-0 mt-0.5 text-xs text-muted-foreground">
                              {firstFix
                                ? `First thing to fix: ${firstFix.label}`
                                : 'Setup checks passed'}
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant={complete ? 'success' : 'warning'}>
                            {complete ? 'Complete' : `${missingCount} missing`}
                          </Badge>
                          {firstFix ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={!canFixThis}
                              title={
                                !canFixThis ? 'Your access does not allow this change.' : undefined
                              }
                              onClick={() => onFix(roomType, firstFix.key as ReadinessKey)}
                            >
                              {check?.fixLabel ?? firstFix.label}{' '}
                              <ArrowUpRight aria-hidden="true" />
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : (
            <EmptyPanel
              title="No room types yet"
              description="Create a room type to see its setup checklist here."
            />
          )}
        </CardContent>
      </Card>

      <Card className="flex h-full min-w-0 flex-col">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-4" aria-hidden="true" /> Recent activity
          </CardTitle>
          <CardDescription>
            Recent room, publication, and photo changes for this property.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1">
          {groupedActivity.length ? (
            <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 xl:grid-cols-2">
              {groupedActivity.slice(0, activityLimit).map((group) => (
                <li
                  key={group.event.id}
                  className="flex items-start justify-between gap-4 border-b pb-3 last:border-b-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="m-0 text-sm font-medium">
                      {activitySentence(group.event)}
                      {group.count > 1 ? (
                        <span className="ml-2 text-xs text-muted-foreground">x{group.count}</span>
                      ) : null}
                    </p>
                    <p className="m-0 mt-1 truncate text-xs text-muted-foreground">
                      {group.event.actorName || 'Unknown user'}
                    </p>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <time
                        className="shrink-0 cursor-default text-xs text-muted-foreground"
                        dateTime={group.event.createdAt}
                        tabIndex={0}
                      >
                        {formatRelativeActivityTime(group.event.createdAt)}
                      </time>
                    </TooltipTrigger>
                    <TooltipContent>{formatActivityDate(group.event.createdAt)}</TooltipContent>
                  </Tooltip>
                </li>
              ))}
              {groupedActivity.length > activityLimit ? (
                <li className="border-b-0 pt-1 xl:col-span-2">
                  <Button
                    variant="link"
                    size="sm"
                    className="h-auto px-0"
                    onClick={() => setActivityLimit((limit) => limit + 8)}
                  >
                    Show more
                  </Button>
                </li>
              ) : null}
            </ol>
          ) : (
            <EmptyPanel
              title="No recent activity"
              description="Accommodation changes will appear here."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
