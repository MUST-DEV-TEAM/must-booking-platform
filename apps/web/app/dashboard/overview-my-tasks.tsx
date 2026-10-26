'use client';

import { useQuery } from '@tanstack/react-query';

import { ListCard, ListRow } from '../../components/ui/list-card';

type Task = { id: string; title: string; priority: string; createdAt: string };

/** The signed-in person's own open alerts (needs-action notifications). Non-critical: hidden if it cannot load. */
export function MyTasksCard({ tenantId, propertyId }: { tenantId: string; propertyId: string }) {
  const base = `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=notifications`;
  const query = useQuery({
    queryKey: ['dashboard', 'my-tasks', tenantId, propertyId],
    queryFn: async () => {
      const response = await fetch(
        `/api/tenants/${tenantId}/properties/${propertyId}/notifications?needsAction=1&pageSize=5`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error('Tasks unavailable');
      return ((await response.json()) as { items?: Task[] }).items ?? [];
    },
    retry: false,
  });
  if (query.isError) return null;
  const items = query.data ?? [];
  return (
    <ListCard
      title="My tasks"
      description="Alerts that still need action."
      count={items.length}
      action={{ label: 'Open notifications', href: base }}
      empty={query.isPending ? 'Loading…' : 'You have nothing to do right now.'}
    >
      {items.map((item) => (
        <ListRow
          key={item.id}
          href={`${base}&notification=${item.id}`}
          title={item.title}
          subtitle={item.priority}
          trailing={new Date(item.createdAt).toLocaleDateString()}
        />
      ))}
    </ListCard>
  );
}
