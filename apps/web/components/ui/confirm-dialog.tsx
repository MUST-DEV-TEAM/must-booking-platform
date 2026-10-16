'use client';

import { useState, type ReactNode } from 'react';

import { Button } from './button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Input, Textarea } from './input';
import { Label } from './label';

/**
 * Asks for confirmation before a sensitive action. It can require a written reason and, for the
 * most serious actions, a typed word. `onConfirm` receives the reason; if it throws, the message
 * is shown inside the dialog and the dialog stays open so nothing is lost.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  reasonLabel,
  reasonRequired = false,
  typedWord,
  children,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** Shows a reason box with this label. */
  reasonLabel?: string;
  reasonRequired?: boolean;
  /** The word the user must type to enable the confirm button (for example "CANCEL"). */
  typedWord?: string;
  /** Extra content, such as an impact summary, shown above the reason. */
  children?: ReactNode;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reasonOk = !reasonRequired || reason.trim().length >= 3;
  const typedOk = !typedWord || typed.trim() === typedWord;
  const canConfirm = reasonOk && typedOk && !busy;

  const close = (next: boolean) => {
    if (busy) return;
    if (!next) {
      setReason('');
      setTyped('');
      setError(null);
    }
    onOpenChange(next);
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      setReason('');
      setTyped('');
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong. Nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm text-muted-foreground">{description}</div>
          </DialogDescription>
        </DialogHeader>
        {children}
        {reasonLabel ? (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-reason">
              {reasonLabel}
              {reasonRequired ? <span className="text-destructive"> *</span> : null}
            </Label>
            <Textarea
              id="confirm-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Visible in the reservation's activity"
            />
          </div>
        ) : null}
        {typedWord ? (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-typed">
              Type <span className="font-mono font-bold">{typedWord}</span> to confirm
            </Label>
            <Input
              id="confirm-typed"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
            />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>
            Keep it
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => void confirm()}
            disabled={!canConfirm}
            loading={busy}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
