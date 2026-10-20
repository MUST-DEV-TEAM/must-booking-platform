import { Button } from './button';

/**
 * Appears at the bottom of a settings form once something has changed. Nothing is saved until
 * the person presses Save; Discard puts the saved values back.
 */
export function SaveBar({
  dirty,
  saving,
  canSave = true,
  onSave,
  onDiscard,
  hint,
}: {
  dirty: boolean;
  saving: boolean;
  /** False while the form has an error that must be fixed first. */
  canSave?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  hint?: string;
}) {
  if (!dirty) return null;
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 shadow-md"
    >
      <p className="m-0 text-sm">
        <span className="font-semibold">You have unsaved changes.</span>
        {hint ? <span className="text-muted-foreground"> {hint}</span> : null}
      </p>
      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={saving} onClick={onDiscard}>
          Discard
        </Button>
        <Button type="button" loading={saving} disabled={!canSave} onClick={onSave}>
          Save changes
        </Button>
      </div>
    </div>
  );
}
