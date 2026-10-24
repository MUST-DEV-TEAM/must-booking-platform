'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';

import { Alert, AlertDescription } from '../../../../../components/ui/alert';
import { Button } from '../../../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../../../components/ui/dialog';
import { FormField } from '../../../../../components/ui/form-field';
import { Input } from '../../../../../components/ui/input';
import { ConsoleApiError, consolePost } from '../../../../../lib/platform-api';

/** Sends (or re-sends) the owner invitation through the hotel’s normal staff invitation email. */
export function InviteOwnerDialog({
  hotelId,
  defaultEmail,
  open,
  onOpenChange,
  onDone,
}: {
  hotelId: string;
  defaultEmail: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [email, setEmail] = useState(defaultEmail);
  const [invalid, setInvalid] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: () => consolePost(`/hotels/${hotelId}/owner-invitations`, { email: email.trim() }),
    onSuccess: () => {
      onDone();
      onOpenChange(false);
    },
  });
  const failure = invite.error instanceof ConsoleApiError ? invite.error : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite the hotel owner</DialogTitle>
          <DialogDescription>
            They get an email to set a password. The invitation works once and expires after seven
            days.
          </DialogDescription>
        </DialogHeader>
        {failure ? (
          <Alert variant="destructive">
            <AlertDescription>
              {failure.message}
              {failure.reference ? ` Reference: ${failure.reference}` : ''}
            </AlertDescription>
          </Alert>
        ) : null}
        <FormField label="Owner email" htmlFor="owner-invite-email" required error={invalid}>
          <Input
            id="owner-invite-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={invite.isPending}
            onClick={() => {
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
                setInvalid('Enter a valid email.');
                return;
              }
              setInvalid(null);
              invite.mutate();
            }}
          >
            Send invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
