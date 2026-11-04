'use client';

import { useState } from 'react';

import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { FormField } from '../../../components/ui/form-field';
import { Checkbox } from '../../../components/ui/checkbox';
import { Input, Textarea } from '../../../components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import type { TableInput, TableShape } from './venue-api';

const SHAPES: Array<{ value: TableShape; label: string }> = [
  { value: 'square', label: 'Square' },
  { value: 'round', label: 'Round' },
  { value: 'rect', label: 'Rectangle' },
];

type Errors = { label?: string; minSeats?: string; maxSeats?: string; priority?: string };

/** Add or edit one table. Mount it with a `key` so it starts fresh for each table. */
export function TableFormDialog({
  open,
  onOpenChange,
  title,
  initial,
  error,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initial?: TableInput;
  error?: string | null;
  saving?: boolean;
  onSubmit: (input: TableInput) => void;
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [minSeats, setMinSeats] = useState(initial ? String(initial.minSeats) : '');
  const [maxSeats, setMaxSeats] = useState(initial ? String(initial.maxSeats) : '');
  const [shape, setShape] = useState<TableShape>(initial?.shape ?? 'square');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [features, setFeatures] = useState<string[]>(initial?.features ?? []);
  const [onlineBookable, setOnlineBookable] = useState(initial?.onlineBookable ?? true);
  const [priority, setPriority] = useState(initial?.priority ?? 0);
  const [errors, setErrors] = useState<Errors>({});

  function submit() {
    const min = Number(minSeats);
    const max = Number(maxSeats);
    const next: Errors = {};
    if (!label.trim()) next.label = 'Enter a label for the table.';
    if (!Number.isInteger(min) || min < 1) next.minSeats = 'Minimum seats must be at least 1.';
    if (!Number.isInteger(max) || max < 1) next.maxSeats = 'Maximum seats must be at least 1.';
    else if (!next.minSeats && max < min)
      next.maxSeats = 'Maximum seats cannot be less than minimum seats.';
    if (!Number.isInteger(priority) || priority < 0 || priority > 1000)
      next.priority = 'Enter a whole number from 0 to 1,000.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    onSubmit({
      label: label.trim(),
      minSeats: min,
      maxSeats: max,
      shape,
      notes,
      features,
      onlineBookable,
      priority,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Guests are offered a table when their party fits between the minimum and maximum seats.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FormField label="Label" htmlFor="table-label" required error={errors.label}>
            <Input id="table-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </FormField>
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Minimum seats" htmlFor="table-min" required error={errors.minSeats}>
              <Input
                id="table-min"
                type="number"
                min={1}
                value={minSeats}
                onChange={(e) => setMinSeats(e.target.value)}
              />
            </FormField>
            <FormField label="Maximum seats" htmlFor="table-max" required error={errors.maxSeats}>
              <Input
                id="table-max"
                type="number"
                min={1}
                value={maxSeats}
                onChange={(e) => setMaxSeats(e.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Shape on the map" htmlFor="table-shape">
            <Select value={shape} onValueChange={(value) => setShape(value as TableShape)}>
              <SelectTrigger id="table-shape" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHAPES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField
            label="Notes"
            htmlFor="table-notes"
            hint="Details for your staff, up to 1,000 characters."
          >
            <Textarea
              id="table-notes"
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </FormField>
          <fieldset className="grid grid-cols-2 gap-2">
            <legend className="text-sm font-medium">Features</legend>
            {[
              ['window', 'Window'],
              ['outdoor', 'Outdoor'],
              ['accessible', 'Accessible'],
              ['quiet', 'Quiet'],
              ['high_chair', 'High chair available'],
            ].map(([tag, name]) => (
              <label key={tag} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={features.includes(tag)}
                  onCheckedChange={(checked) =>
                    setFeatures((current) =>
                      checked ? [...current, tag] : current.filter((value) => value !== tag),
                    )
                  }
                />
                {name}
              </label>
            ))}
          </fieldset>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={onlineBookable}
              onCheckedChange={(checked) => setOnlineBookable(checked === true)}
            />
            Can be booked online
          </label>
          <FormField
            label="Priority"
            htmlFor="table-priority"
            error={errors.priority}
            hint="Higher numbers are preferred among tables of the same capacity (0 to 1,000)."
          >
            <Input
              id="table-priority"
              type="number"
              min={0}
              max={1000}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
          </FormField>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            Save table
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
