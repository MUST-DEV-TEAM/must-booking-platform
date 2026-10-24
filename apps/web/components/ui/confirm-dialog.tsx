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
  cancelLabel = 'Keep it',
  destructive = false,
  reasonLabel,
  reasonRequired = false,
  reasonPlaceholder = "Visible in the reservation's activity",
  typedWord,
  confirmDisabled = false,
  contentClassName,
  scrollBody = false,
  children,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Shows a reason box with this label. */
  reasonLabel?: string;
  reasonRequired?: boolean;
  reasonPlaceholder?: string;
  /** The word the user must type to enable the confirm button (for example "CANCEL"). */
  typedWord?: string;
  /** Keeps the confirm button off while something in `children` is not valid yet. */
  confirmDisabled?: boolean;
  contentClassName?: string;
  scrollBody?: boolean;
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
  const canConfirm = reasonOk && typedOk && !busy && !confirmDisabled;

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
      setError(
        caught instanceof Error ? caught.message : 'Something went wrong. Nothing was changed.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className={`${scrollBody ? 'flex max-h-[90dvh] flex-col overflow-hidden p-0 gap-0' : ''} ${contentClassName || ''}`}
      >
        <DialogHeader className={scrollBody ? 'shrink-0 p-6 pb-4' : undefined}>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="text-sm text-muted-foreground">{description}</div>
          </DialogDescription>
        </DialogHeader>
        <div
          className={scrollBody ? 'min-h-0 flex-1 overflow-y-auto px-6 pb-5 space-y-5' : 'contents'}
        >
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
                placeholder={reasonPlaceholder}
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
        </div>
        <DialogFooter className={scrollBody ? 'shrink-0 border-t bg-card px-6 py-4' : undefined}>
          <Button variant="outline" onClick={() => close(false)} disabled={busy}>
            {cancelLabel}
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
