'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, LifeBuoy, Mail } from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '../../../../../components/ui/badge';
import { Button } from '../../../../../components/ui/button';
import { DetailHeader } from '../../../../../components/ui/detail-header';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../../../components/ui/dropdown-menu';
import { PermissionPanel } from '../../../../../components/ui/permission-panel';
import { Skeleton } from '../../../../../components/ui/skeleton';
import { ErrorPanel } from '../../../../../components/ui/state-panel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../../../../components/ui/tabs';
import {
  ConsoleApiError,
  consoleGet,
  type HotelDetail,
  LIFECYCLE_LABELS,
  MODE_LABELS,
} from '../../../../../lib/platform-api';
import { formatDate } from '../../../../../lib/platform-format';
import { LifecycleBadge } from '../../../lifecycle-badge';
import { useConsoleSession } from '../../console-frame';
import { ConnectionsTab } from './connections-tab';
import { InviteOwnerDialog } from './invite-owner-dialog';
import { LifecycleDialog } from './lifecycle-dialog';
import { OverviewTab } from './overview-tab';
import { StaffUsageTab } from './staff-usage-tab';
import { SupportAccessDialog } from './support-access-dialog';

const TABS = ['overview', 'connections', 'staff'] as const;
type Tab = (typeof TABS)[number];

export function HotelDetailView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const queryClient = useQueryClient();
  const { can } = useConsoleSession();
  const requested = search.get('tab');
  const tab: Tab = TABS.find((value) => value === requested) ?? 'overview';

  const [lifecycleTarget, setLifecycleTarget] = useState<HotelDetail['lifecycle']['state'] | null>(
    null,
  );
  const [supportOpen, setSupportOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const detail = useQuery({
    queryKey: ['platform-console', 'hotel', id],
    queryFn: () => consoleGet<HotelDetail>(`/hotels/${id}`),
    enabled: can('platform.hotels.view'),
  });

  if (!can('platform.hotels.view')) return <PermissionPanel />;
  if (detail.isLoading)
    return (
      <div className="space-y-4" role="status" aria-label="Loading hotel">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (detail.isError || !detail.data) {
    const error = detail.error;
    return error instanceof ConsoleApiError && error.status === 404 ? (
      <ErrorPanel
        title="Hotel not found"
        description="This hotel does not exist, or the link is wrong."
        reference={error.reference ?? undefined}
      />
    ) : (
      <ErrorPanel
        title="We couldn’t load this hotel"
        reference={error instanceof ConsoleApiError ? (error.reference ?? undefined) : undefined}
        onRetry={() => void detail.refetch()}
      />
    );
  }

  const hotel = detail.data;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['platform-console', 'hotel', id] });
    void queryClient.invalidateQueries({ queryKey: ['platform-console', 'hotels'] });
    void queryClient.invalidateQueries({ queryKey: ['platform-console', 'onboarding', id] });
  };
  const canSupport = can('platform.support.view_as') || can('platform.support.act_as');

  return (
    <div className="space-y-6">
      <DetailHeader
        backHref="/platform/hotels"
        backLabel="All hotels"
        reference={hotel.id}
        title={hotel.name}
        subtitle={[
          hotel.country,
          hotel.timeZone,
          hotel.currency,
          `Created ${formatDate(hotel.createdAt)}`,
        ]
          .filter(Boolean)
          .join(' · ')}
        badges={
          <>
            <LifecycleBadge state={hotel.lifecycle.state} />
            <Badge variant="outline">{MODE_LABELS[hotel.mode]}</Badge>
          </>
        }
        actions={
          <>
            {!hotel.owner && can('platform.hotels.create') ? (
              <Button variant="outline" onClick={() => setInviteOpen(true)}>
                <Mail aria-hidden="true" /> {hotel.ownerInvite ? 'Re-invite owner' : 'Invite owner'}
              </Button>
            ) : null}
            {canSupport ? (
              <Button variant="outline" onClick={() => setSupportOpen(true)}>
                <LifeBuoy aria-hidden="true" /> Open as support
              </Button>
            ) : null}
            {hotel.lifecycle.allowedTransitions.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button>
                    Change status <ChevronDown aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {hotel.lifecycle.allowedTransitions.map((state) => (
                    <DropdownMenuItem key={state} onSelect={() => setLifecycleTarget(state)}>
                      Move to {LIFECYCLE_LABELS[state]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />

      <Tabs
        value={tab}
        onValueChange={(value) => router.replace(`/platform/hotels/${id}?tab=${value}`)}
      >
        <TabsList>
          <TabsTrigger value="overview">Overview and status</TabsTrigger>
          <TabsTrigger value="connections">Connections</TabsTrigger>
          <TabsTrigger value="staff">Staff and usage</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="pt-4">
          <OverviewTab hotel={hotel} onInviteOwner={() => setInviteOpen(true)} />
        </TabsContent>
        <TabsContent value="connections" className="pt-4">
          {tab === 'connections' ? <ConnectionsTab hotelId={id} /> : null}
        </TabsContent>
        <TabsContent value="staff" className="pt-4">
          {tab === 'staff' ? <StaffUsageTab hotelId={id} /> : null}
        </TabsContent>
      </Tabs>

      {lifecycleTarget ? (
        <LifecycleDialog
          hotel={hotel}
          target={lifecycleTarget}
          onClose={() => setLifecycleTarget(null)}
          onDone={refresh}
        />
      ) : null}
      <SupportAccessDialog hotel={hotel} open={supportOpen} onOpenChange={setSupportOpen} />
      <InviteOwnerDialog
        hotelId={hotel.id}
        defaultEmail={hotel.ownerInvite?.email ?? ''}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onDone={refresh}
      />
    </div>
  );
}
