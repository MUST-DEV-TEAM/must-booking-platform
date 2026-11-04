'use client';

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useRef, type KeyboardEvent } from 'react';

import { cn } from '../../lib/utils';
import { clampToCanvas, keyboardStep, movedPosition, tableDimensions } from './floor-map-geometry';

export type FloorMapTable = {
  id: string;
  label: string;
  /** Short seat text shown under the label, for example "2 to 4 seats". */
  seats: string;
  /** Top-left corner and size, in canvas units. */
  x: number;
  y: number;
  w: number;
  h: number;
  shape: 'square' | 'round' | 'rect';
  /** The table has been moved and not saved yet. */
  moved?: boolean;
  /** Colour classes (background, border, text) for a live state such as "seated". */
  tone?: string;
  /** A second line under the label, for example the guest's name. Replaces the seat text. */
  caption?: string;
};

/**
 * A top-down plan of one area. Tables are placed by percentage of the canvas, so the plan scales
 * to any screen. Drag a table (or focus it and use the arrow keys) to move it; Enter or a click
 * selects it. The component only reports moves: the owner of the state decides what to do.
 */
export function FloorMap({
  width,
  height,
  tables,
  editable,
  gridSize = 10,
  selectedId,
  onMove,
  onSelect,
  label = 'Floor map',
}: {
  width: number;
  height: number;
  tables: readonly FloorMapTable[];
  editable: boolean;
  gridSize?: number;
  selectedId?: string | null;
  onMove: (tableId: string, x: number, y: number) => void;
  onSelect: (tableId: string) => void;
  label?: string;
}) {
  tables = tables.map((table) => ({ ...table, ...tableDimensions(table.shape, table.w, table.h) }));
  const canvasRef = useRef<HTMLDivElement>(null);
  // A small drag distance first, so a plain click still selects instead of starting a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function onDragEnd(event: DragEndEvent) {
    const table = tables.find((candidate) => candidate.id === event.active.id);
    if (!table) return;
    const drawn = canvasRef.current?.getBoundingClientRect().width ?? 0;
    const next = movedPosition(table, event.delta, drawn / width, gridSize, { width, height });
    if (next.x !== table.x || next.y !== table.y) onMove(table.id, next.x, next.y);
  }

  function onKey(table: FloorMapTable, event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(table.id);
      return;
    }
    const step = editable ? keyboardStep(event.key, gridSize) : null;
    if (!step) return;
    event.preventDefault();
    const next = clampToCanvas(
      { ...table, x: table.x + step.x, y: table.y + step.y },
      {
        width,
        height,
      },
    );
    if (next.x !== table.x || next.y !== table.y) onMove(table.id, next.x, next.y);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div
        ref={canvasRef}
        role="group"
        aria-label={label}
        className="@container relative w-full overflow-hidden rounded-lg border bg-muted/30"
        style={{
          aspectRatio: `${width} / ${height}`,
          backgroundImage:
            'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
          backgroundSize: `${(gridSize * 100) / width}% ${(gridSize * 100) / height}%`,
        }}
      >
        {tables.map((table) => (
          <MapTable
            key={table.id}
            table={table}
            canvas={{ width, height }}
            editable={editable}
            selected={table.id === selectedId}
            onSelect={onSelect}
            onKey={onKey}
          />
        ))}
      </div>
    </DndContext>
  );
}

function MapTable({
  table,
  canvas,
  editable,
  selected,
  onSelect,
  onKey,
}: {
  table: FloorMapTable;
  canvas: { width: number; height: number };
  editable: boolean;
  selected: boolean;
  onSelect: (tableId: string) => void;
  onKey: (table: FloorMapTable, event: KeyboardEvent<HTMLElement>) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: table.id,
    disabled: !editable,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role="button"
      // A read-only map can still be selected, so it is not "disabled" for assistive technology.
      aria-disabled={editable ? attributes['aria-disabled'] : undefined}
      aria-roledescription={editable ? attributes['aria-roledescription'] : undefined}
      tabIndex={0}
      aria-label={`${table.label}, ${table.seats}`}
      aria-pressed={selected}
      onClick={() => onSelect(table.id)}
      onKeyDown={(event) => onKey(table, event)}
      className={cn(
        'absolute flex touch-none flex-col items-center justify-center overflow-hidden border-2 text-center text-xs leading-tight shadow-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        table.tone ?? 'bg-card',
        editable ? 'cursor-grab' : 'cursor-pointer',
        isDragging && 'z-10 cursor-grabbing shadow-md',
        selected
          ? 'border-primary ring-2 ring-primary'
          : table.tone
            ? null
            : table.moved
              ? 'border-warning'
              : 'border-border',
      )}
      style={{
        left: `${(table.x * 100) / canvas.width}%`,
        top: `${(table.y * 100) / canvas.height}%`,
        width: `${(table.w * 100) / canvas.width}%`,
        height: `${(table.h * 100) / canvas.height}%`,
        borderRadius: table.shape === 'round' ? '50%' : undefined,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
    >
      {/* The label scales with the map; the seat text only fits once the map is wide enough. */}
      <span className="font-semibold" style={{ fontSize: 'clamp(8px, 2.2cqw, 13px)' }}>
        {table.label}
      </span>
      <span
        className={cn(
          'hidden max-w-full truncate px-1 @min-[560px]:block',
          !table.tone && 'text-muted-foreground',
        )}
      >
        {table.caption ?? table.seats}
      </span>
    </div>
  );
}
