'use client';
import { useQuery } from '@tanstack/react-query';
import { Clock3 } from 'lucide-react';
import { useState } from 'react';
import { QuickPeek } from '../../components/ui/quick-peek';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { DetailList, SectionLabel } from '../../components/ui/detail-list';
import { TabBar } from '../../components/ui/tab-bar';
import { ActivityFeed } from '../../components/ui/activity-feed';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { inventoryRequest } from './inventory-api';
import {
  recordName,
  restrictionLabels,
  blockReasonLabels,
  inventoryScope,
  type CatalogItem,
  type InventoryRecord,
} from './inventory-types';
export type InventoryAction = { label: string; action: string };
/** Quick peek with schedule, effect, validation and persisted version history. */
export function InventorySheet({
  record,
  kind,
  base,
  catalog,
  categories,
  rooms,
  actions,
  onAction,
  onEdit,
  onClose,
  actorNames = {},
}: {
  record: InventoryRecord;
  kind: 'restrictions' | 'blocks';
  base: string;
  catalog: CatalogItem[];
  categories: CatalogItem[];
  rooms: CatalogItem[];
  actions: InventoryAction[];
  onAction: (action: string) => void;
  onEdit?: () => void;
  onClose: () => void;
  actorNames?: Record<string, string>;
}) {
  const [tab, setTab] = useState('details');
  const history = useQuery({
    queryKey: ['dashboard', 'inventory-history', base, kind, record.id, record.version],
    queryFn: () =>
      inventoryRequest<{ id: string; action: string; actorUserId: string; createdAt: string }[]>(
        `${base}/${kind}/${record.id}/history`,
      ),
    enabled: tab === 'history',
  });
  return (
    <QuickPeek
      open
      onClose={onClose}
      title={recordName(record)}
      description={`${record.inventoryReference ?? record.reference ?? 'Legacy block'} - Version ${record.version}`}
      badges={
        <>
          <Badge>{record.lifecycle}</Badge>
          <Badge variant={record.validation === 'Conflict' ? 'danger' : 'secondary'}>
            {record.validation ?? 'Healthy'}
          </Badge>
        </>
      }
      actions={
        <>
          {onEdit ? <Button onClick={onEdit}>Edit</Button> : null}
          {actions.map((a) => (
            <Button key={a.action} variant="outline" onClick={() => onAction(a.action)}>
              {a.label}
            </Button>
          ))}
        </>
      }
    >
      <TabBar
        label="Record details"
        current={tab}
        onSelect={setTab}
        tabs={[
          { id: 'details', label: 'Details' },
          { id: 'history', label: 'History' },
        ]}
      />
      {tab === 'history' ? (
        history.isPending ? (
          <ListSkeleton rows={3} />
        ) : history.error ? (
          <ErrorPanel description={history.error.message} onRetry={() => void history.refetch()} />
        ) : (
          <ActivityFeed
            entries={(history.data ?? [])
              .slice()
              .reverse()
              .map((item) => ({
                key: item.id,
                title: item.action.replace(/inventory_(restriction|block)\./, ''),
                at: item.createdAt,
                actor: actorNames[item.actorUserId] ?? 'Name unavailable',
                icon: Clock3,
                detail: 'Versioned change recorded.',
              }))}
          />
        )
      ) : (
        <>
          <DetailList
            items={[
              { label: 'Scope', value: inventoryScope(record, catalog, categories, rooms) },
              { label: 'From', value: record.startsOn },
              {
                label: kind === 'restrictions' ? 'Through (inclusive)' : 'Available again',
                value: record.endsOn ?? 'No end date',
              },
              {
                label: 'Rule type',
                value: record.type ? restrictionLabels[record.type] : undefined,
              },
              { label: 'Value', value: record.value },
              { label: 'Priority', value: record.priority },
              {
                label: 'Weekdays',
                value: record.weekdays
                  ?.map((d) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d - 1])
                  .join(', '),
              },
              {
                label: 'Reason',
                value: record.reason ? blockReasonLabels[record.reason] : undefined,
              },
              {
                label: 'Responsible staff',
                value: record.responsibleStaffId
                  ? (actorNames[record.responsibleStaffId] ?? 'Name unavailable')
                  : undefined,
              },
              {
                label: 'Work order',
                value: record.inventoryReference ? record.reference : undefined,
              },
              { label: 'Internal notes', value: record.internalReason ?? record.note },
              { label: 'End reason', value: record.endReason },
              {
                label: 'Created by',
                value:
                  record.createdByEmail ??
                  (record.createdByUserId
                    ? (actorNames[record.createdByUserId] ?? 'Name unavailable')
                    : undefined),
              },
              {
                label: 'Updated by',
                value: record.updatedByUserId
                  ? (actorNames[record.updatedByUserId] ?? 'Name unavailable')
                  : undefined,
              },
              {
                label: 'Updated',
                value: record.updatedAt ? new Date(record.updatedAt).toLocaleString() : undefined,
              },
            ]}
          />
          {record.conflicts?.length ? (
            <>
              <SectionLabel>Conflicts</SectionLabel>
              <DetailList
                items={record.conflicts.map((c, index) => ({
                  label: `${c.kind ?? 'Restriction'} ${index + 1}`,
                  value: `${c.reference ?? c.name ?? c.id}${c.date ? ' - ' + c.date : ''}`,
                }))}
              />
            </>
          ) : null}
        </>
      )}
    </QuickPeek>
  );
}
