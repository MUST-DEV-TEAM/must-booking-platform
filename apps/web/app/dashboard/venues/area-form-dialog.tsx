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
import { Input } from '../../../components/ui/input';

/** Add or rename an area. Mount it with a `key` so it starts fresh each time. */
export function AreaFormDialog({
  open,
  onOpenChange,
  title,
  initialName = '',
  error,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initialName?: string;
  error?: string | null;
  saving?: boolean;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [nameError, setNameError] = useState<string | null>(null);

  function submit() {
    if (!name.trim()) {
      setNameError('Enter a name for the area.');
      return;
    }
    setNameError(null);
    onSubmit(name.trim());
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            An area is a part of the restaurant, such as a terrace or a dining room. Each area has
            its own floor map.
          </DialogDescription>
        </DialogHeader>
        <FormField label="Name" htmlFor="area-name" required error={nameError}>
          <Input id="area-name" value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            Save area
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
