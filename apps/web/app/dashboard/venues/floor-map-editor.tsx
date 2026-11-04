'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { Input } from '../../../components/ui/input';
import { resizedTable, tableDimensions } from '../../../components/ui/floor-map-geometry';
import { FloorMap } from '../../../components/ui/floor-map';
import { seatsText } from './seats';
import { venueApi, type VenueArea } from './venue-api';

type Combination = { tableAId: string; tableBId: string };
type Position = { x: number; y: number };

/**
 * The floor map of one area. Moves stay on screen until "Save layout", which sends all of them in
 * one request. Selecting a table lets staff say which other tables can be pushed together with it.
 */
export function FloorMapEditor({
  tenantId,
  venueId,
  area,
  combinations,
}: {
  tenantId: string;
  venueId: string;
  area: VenueArea;
  combinations: readonly Combination[];
}) {
  const queryClient = useQueryClient();
  const [moves, setMoves] = useState<Record<string, Position>>({});
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['venue-layout', tenantId, venueId] });

  const save = useMutation({
    mutationFn: () =>
      venueApi.savePositions(
        tenantId,
        venueId,
        [...new Set([...Object.keys(moves), ...Object.keys(sizes)])].map((tableId) => {
          const table = area.tables.find((row) => row.id === tableId)!;
          return {
            tableId,
            mapX: moves[tableId]?.x ?? table.mapX,
            mapY: moves[tableId]?.y ?? table.mapY,
            ...(sizes[tableId] ? { mapWidth: sizes[tableId].w, mapHeight: sizes[tableId].h } : {}),
          };
        }),
      ),
    onSuccess: async () => {
      await refresh();
      setMoves({});
      setSizes({});
    },
  });
  const combine = useMutation({
    mutationFn: (input: { tableId: string; tableIds: string[] }) =>
      venueApi.setCombinable(tenantId, venueId, input.tableId, input.tableIds),
    onSuccess: refresh,
  });

  const moved = new Set([...Object.keys(moves), ...Object.keys(sizes)]).size;
  const selected = area.tables.find((table) => table.id === selectedId) ?? null;
  const partners = (tableId: string) =>
    combinations.flatMap((pair) =>
      pair.tableAId === tableId
        ? [pair.tableBId]
        : pair.tableBId === tableId
          ? [pair.tableAId]
          : [],
    );

  if (area.tables.length === 0)
    return (
      <Alert variant="info">
        <AlertDescription>Add tables first, then arrange them on the map.</AlertDescription>
      </Alert>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p aria-live="polite" className="mr-auto text-sm text-muted-foreground">
          {moved === 0 ? 'No unsaved changes' : `${moved} unsaved change${moved === 1 ? '' : 's'}`}
        </p>
        {moved > 0 ? (
          <Button
            variant="outline"
            onClick={() => {
              setMoves({});
              setSizes({});
            }}
          >
            Discard changes
          </Button>
        ) : null}
        <Button disabled={moved === 0 || save.isPending} onClick={() => save.mutate()}>
          Save layout
        </Button>
      </div>
      {save.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{save.error.message}</AlertDescription>
        </Alert>
      ) : null}

      <FloorMap
        label={`${area.name} floor map`}
        width={area.mapWidth}
        height={area.mapHeight}
        editable
        selectedId={selectedId}
        onSelect={setSelectedId}
        onMove={(tableId, x, y) => setMoves((current) => ({ ...current, [tableId]: { x, y } }))}
        tables={area.tables.map((table) => ({
          id: table.id,
          label: table.label,
          seats: seatsText(table.minSeats, table.maxSeats),
          x: moves[table.id]?.x ?? table.mapX,
          y: moves[table.id]?.y ?? table.mapY,
          ...tableDimensions(
            table.shape,
            sizes[table.id]?.w ?? table.mapWidth,
            sizes[table.id]?.h ?? table.mapHeight,
          ),
          shape: table.shape,
          moved: table.id in moves,
        }))}
      />

      {selected ? (
        <fieldset className="space-y-2 rounded-lg border p-4">
          <legend className="px-1 text-sm font-semibold">Table {selected.label}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {(['w', 'h'] as const)
              .filter((axis) => selected.shape === 'rect' || axis === 'w')
              .map((axis) => (
                <label key={axis} className="space-y-1 text-sm">
                  {selected.shape === 'rect'
                    ? axis === 'w'
                      ? 'Map width'
                      : 'Map height'
                    : 'Map size'}
                  <Input
                    type="number"
                    min={20}
                    max={axis === 'w' ? area.mapWidth : area.mapHeight}
                    aria-label={axis === 'w' ? 'Map width' : 'Map height'}
                    value={
                      (sizes[selected.id] ??
                        tableDimensions(selected.shape, selected.mapWidth, selected.mapHeight))[
                        axis
                      ]
                    }
                    onChange={(e) => {
                      const current =
                        sizes[selected.id] ??
                        tableDimensions(selected.shape, selected.mapWidth, selected.mapHeight);
                      const result = resizedTable(
                        {
                          x: moves[selected.id]?.x ?? selected.mapX,
                          y: moves[selected.id]?.y ?? selected.mapY,
                          ...current,
                        },
                        selected.shape,
                        { ...current, [axis]: Number(e.target.value) },
                        { width: area.mapWidth, height: area.mapHeight },
                      );
                      setSizes((values) => ({
                        ...values,
                        [selected.id]: { w: result.w, h: result.h },
                      }));
                      setMoves((values) => ({
                        ...values,
                        [selected.id]: { x: result.x, y: result.y },
                      }));
                    }}
                  />
                </label>
              ))}
          </div>
          <p className="text-sm font-semibold">Can be pushed together with</p>
          {combine.isError ? (
            <Alert variant="destructive">
              <AlertDescription>{combine.error.message}</AlertDescription>
            </Alert>
          ) : null}
          {area.tables.filter((other) => other.id !== selected.id).length === 0 ? (
            <p className="text-sm text-muted-foreground">There are no other tables in this area.</p>
          ) : (
            area.tables
              .filter((other) => other.id !== selected.id)
              .map((other) => {
                const current = partners(selected.id);
                const checked = current.includes(other.id);
                return (
                  <label key={other.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      aria-label={`Combine ${selected.label} with ${other.label}`}
                      checked={checked}
                      disabled={combine.isPending}
                      onCheckedChange={(value) =>
                        combine.mutate({
                          tableId: selected.id,
                          tableIds:
                            value === true
                              ? [...current, other.id]
                              : current.filter((id) => id !== other.id),
                        })
                      }
                    />
                    {other.label} ({seatsText(other.minSeats, other.maxSeats)})
                  </label>
                );
              })
          )}
        </fieldset>
      ) : null}
    </div>
  );
}
