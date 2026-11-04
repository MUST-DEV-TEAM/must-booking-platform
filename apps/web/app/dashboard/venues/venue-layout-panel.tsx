'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { ConfirmDialog } from '../../../components/ui/confirm-dialog';
import { ListCard, ListRow } from '../../../components/ui/list-card';
import { TabBar } from '../../../components/ui/tab-bar';
import { AreaFormDialog } from './area-form-dialog';
import { FloorMapEditor } from './floor-map-editor';
import { seatsText } from './seats';
import { TableFormDialog } from './table-form-dialog';
import { venueApi, type TableInput, type VenueArea, type VenueTable } from './venue-api';

const SHAPE_LABEL = { square: 'Square', round: 'Round', rect: 'Rectangle' } as const;

type Editing =
  | { kind: 'area'; area: VenueArea | null }
  | { kind: 'table'; table: VenueTable | null }
  | { kind: 'delete-area'; area: VenueArea }
  | { kind: 'delete-table'; table: VenueTable }
  | null;

/**
 * Areas, tables and the floor map of one restaurant. Used by the first-time setup guide and by the
 * Setup tab, so both edit the same thing the same way.
 */
export function VenueLayoutPanel({
  tenantId,
  venueId,
  initialView = 'tables',
}: {
  tenantId: string;
  venueId: string;
  initialView?: 'tables' | 'map';
}) {
  const queryClient = useQueryClient();
  const layout = useQuery({
    queryKey: ['venue-layout', tenantId, venueId],
    queryFn: () => venueApi.getLayout(tenantId, venueId),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [view, setView] = useState<'tables' | 'map'>(initialView);

  const areas = layout.data?.areas ?? [];
  const selected = areas.find((area) => area.id === selectedId) ?? areas[0] ?? null;

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['venue-layout', tenantId, venueId] });
  const done = async () => {
    await refresh();
    setEditing(null);
  };

  const saveArea = useMutation({
    mutationFn: (name: string) =>
      editing?.kind === 'area' && editing.area
        ? venueApi.updateArea(tenantId, venueId, editing.area.id, { name })
        : venueApi.createArea(tenantId, venueId, { name }),
    onSuccess: async (area) => {
      setSelectedId(area.id);
      await done();
    },
  });
  const saveTable = useMutation({
    mutationFn: (input: TableInput) =>
      editing?.kind === 'table' && editing.table
        ? venueApi.updateTable(tenantId, venueId, editing.table.id, input)
        : venueApi.createTable(tenantId, venueId, selected!.id, input),
    onSuccess: done,
  });
  const removeArea = useMutation({
    mutationFn: (areaId: string) => venueApi.deleteArea(tenantId, venueId, areaId),
    onSuccess: async () => {
      setSelectedId(null);
      await done();
    },
  });
  const removeTable = useMutation({
    mutationFn: (tableId: string) => venueApi.deleteTable(tenantId, venueId, tableId),
    onSuccess: done,
  });

  if (layout.isPending) return <p className="text-sm text-muted-foreground">Loading tables…</p>;
  if (layout.isError)
    return (
      <Alert variant="destructive">
        <AlertDescription>{layout.error.message}</AlertDescription>
      </Alert>
    );

  const close = (open: boolean) => {
    if (!open) {
      setEditing(null);
      saveArea.reset();
      saveTable.reset();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setEditing({ kind: 'area', area: null })}>Add area</Button>
      </div>

      {areas.length === 0 ? (
        <Alert variant="info">
          <AlertDescription>
            No areas yet. Add an area, such as a terrace or a dining room, then add its tables.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <TabBar
            label="Areas"
            tabs={areas.map((area) => ({
              id: area.id,
              label: area.name,
              count: area.tables.length,
            }))}
            current={selected!.id}
            onSelect={setSelectedId}
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setEditing({ kind: 'table', table: null })}>Add table</Button>
            <Button variant="outline" onClick={() => setEditing({ kind: 'area', area: selected })}>
              Rename area
            </Button>
            <Button
              variant="outline"
              onClick={() => setEditing({ kind: 'delete-area', area: selected! })}
            >
              Delete area
            </Button>
          </div>
          <TabBar
            label="View"
            tabs={[
              { id: 'tables', label: 'Tables' },
              { id: 'map', label: 'Map' },
            ]}
            current={view}
            onSelect={(id) => setView(id as 'tables' | 'map')}
          />
          {view === 'map' ? (
            <FloorMapEditor
              key={selected!.id}
              tenantId={tenantId}
              venueId={venueId}
              area={selected!}
              combinations={layout.data!.combinations}
            />
          ) : (
            <ListCard
              title={selected!.name}
              count={selected!.tables.length}
              empty="No tables in this area yet."
            >
              {selected!.tables.map((table) => (
                <ListRow
                  key={table.id}
                  title={table.label}
                  subtitle={`${seatsText(table.minSeats, table.maxSeats)} · ${SHAPE_LABEL[table.shape]}`}
                  trailing={
                    <span className="flex items-center gap-2">
                      {table.active ? null : <Badge variant="secondary">Inactive</Badge>}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing({ kind: 'table', table })}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditing({ kind: 'delete-table', table })}
                      >
                        Delete
                      </Button>
                    </span>
                  }
                />
              ))}
            </ListCard>
          )}
        </>
      )}

      {editing?.kind === 'area' ? (
        <AreaFormDialog
          key={editing.area?.id ?? 'new-area'}
          open
          onOpenChange={close}
          title={editing.area ? 'Rename area' : 'Add area'}
          initialName={editing.area?.name}
          error={saveArea.error?.message}
          saving={saveArea.isPending}
          onSubmit={(name) => saveArea.mutate(name)}
        />
      ) : null}
      {editing?.kind === 'table' ? (
        <TableFormDialog
          key={editing.table?.id ?? 'new-table'}
          open
          onOpenChange={close}
          title={editing.table ? 'Edit table' : 'Add table'}
          initial={editing.table ?? undefined}
          error={saveTable.error?.message}
          saving={saveTable.isPending}
          onSubmit={(input) => saveTable.mutate(input)}
        />
      ) : null}
      {editing?.kind === 'delete-area' ? (
        <ConfirmDialog
          open
          onOpenChange={close}
          title="Delete this area?"
          description={`${editing.area.name} will be removed. An area that still has tables cannot be deleted.`}
          confirmLabel="Delete area"
          destructive
          onConfirm={async () => {
            await removeArea.mutateAsync(editing.area.id);
          }}
        />
      ) : null}
      {editing?.kind === 'delete-table' ? (
        <ConfirmDialog
          open
          onOpenChange={close}
          title="Delete this table?"
          description={`Table ${editing.table.label} will be removed from the map.`}
          confirmLabel="Delete table"
          destructive
          onConfirm={async () => {
            await removeTable.mutateAsync(editing.table.id);
          }}
        />
      ) : null}
    </div>
  );
}
