/** Pure position maths for the floor map. Positions are in canvas units, not screen pixels. */
export type Rect = { x: number; y: number; w: number; h: number };
export type Canvas = { width: number; height: number };

export function snap(value: number, grid: number): number {
  return grid > 1 ? Math.round(value / grid) * grid : value;
}

/** Moves the top-left corner so the whole table stays inside the canvas. */
export function clampToCanvas(rect: Rect, canvas: Canvas): { x: number; y: number } {
  return {
    x: Math.min(Math.max(rect.x, 0), Math.max(canvas.width - rect.w, 0)),
    y: Math.min(Math.max(rect.y, 0), Math.max(canvas.height - rect.h, 0)),
  };
}

/**
 * Where a table ends up after being dragged by `delta` screen pixels. `scale` is screen pixels per
 * canvas unit (a 1000-unit canvas drawn 500px wide has scale 0.5); 0 means not measured yet.
 */
export function movedPosition(
  table: Rect,
  delta: { x: number; y: number },
  scale: number,
  grid: number,
  canvas: Canvas,
): { x: number; y: number } {
  const unit = scale > 0 ? scale : 1;
  return clampToCanvas(
    {
      ...table,
      x: snap(table.x + delta.x / unit, grid),
      y: snap(table.y + delta.y / unit, grid),
    },
    canvas,
  );
}

const STEPS: Record<string, (grid: number) => { x: number; y: number }> = {
  ArrowRight: (grid) => ({ x: grid, y: 0 }),
  ArrowLeft: (grid) => ({ x: -grid, y: 0 }),
  ArrowDown: (grid) => ({ x: 0, y: grid }),
  ArrowUp: (grid) => ({ x: 0, y: -grid }),
};

/** One grid step for an arrow key, or null for any other key. */
export function keyboardStep(key: string, grid: number): { x: number; y: number } | null {
  return STEPS[key]?.(grid) ?? null;
}

/** Canvas size describes the shape independently of seating capacity, including legacy maps. */
export function tableDimensions(shape: 'square' | 'round' | 'rect', w: number, h: number) {
  return shape === 'rect' ? { w: w === h ? Math.round(w * 1.5) : w, h } : { w, h: w };
}

/** Resizing keeps circles and squares proportional, and keeps the whole table inside its area. */
export function resizedTable(
  rect: Rect,
  shape: 'square' | 'round' | 'rect',
  size: { w: number; h: number },
  canvas: Canvas,
): Rect {
  const w = Math.max(20, Math.min(Math.round(size.w), canvas.width));
  const h = Math.max(20, Math.min(Math.round(size.h), canvas.height));
  const dimensions = tableDimensions(shape, w, h);
  if (shape !== 'rect') dimensions.w = dimensions.h = Math.min(w, canvas.height);
  else dimensions.w = Math.min(dimensions.w, canvas.width);
  return { ...dimensions, ...clampToCanvas({ ...rect, ...dimensions }, canvas) };
}
