'use client';
import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { SectionLabel } from '../../components/ui/detail-list';
import { createEmailWriter } from '../../lib/email-workspace';
import type { EmailSendingProfile } from './email-sending-profile';

/** Explicit activation of saved verified setup; pausing preserves frozen delivery intentions. */
export function EmailSenderActivation({
  base,
  profile,
  disabled,
  setBusy,
  refresh,
}: {
  base: string;
  profile: EmailSendingProfile;
  disabled: boolean;
  setBusy: (value: boolean) => void;
  refresh: () => Promise<unknown>;
}) {
  const [approval, setApproval] = useState<{ active: boolean; version: number } | null>(null),
    [error, setError] = useState('');
  const writer = useRef(createEmailWriter());
  if (profile.mode === 'DEFAULT') return null;
  const active = profile.activeMode !== 'DEFAULT';
  const approvedActive = approval?.active ?? active;
  const ready =
    profile.credentialsPresent &&
    (profile.mode === 'SMTP'
      ? profile.connectionStatus === 'verified' &&
        Boolean(profile.connectionCheckedAt && profile.fromVerifiedAt)
      : profile.domainStatus === 'verified' && Boolean(profile.domainCheckedAt));
  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>Sender activation</SectionLabel>
      <p className="m-0 text-sm text-muted-foreground">
        {active
          ? 'New hotel emails use the custom sender. Pause it before running domain or connection diagnostics.'
          : ready
            ? 'Saved setup is verified. Activate it to use this sender for new hotel emails.'
            : profile.mode === 'SMTP'
              ? 'Check the saved connection and verify the From mailbox before activation.'
              : 'Verify the saved sending domain before activation.'}
      </p>
      <Button
        variant={active ? 'outline' : 'default'}
        disabled={disabled || (!active && !ready)}
        onClick={() => setApproval({ active, version: profile.version })}
      >
        {active ? 'Pause custom sending' : 'Activate custom sender'}
      </Button>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <ConfirmDialog
        open={approval !== null}
        onOpenChange={(open) => {
          if (!open) setApproval(null);
        }}
        title={approvedActive ? 'Pause custom sending?' : 'Activate custom sender?'}
        description={
          approvedActive
            ? 'New hotel emails will use the MUST sender. Already frozen attempts keep their original sender; uncertain delivery is never rerouted.'
            : 'New hotel emails will use the saved verified sender. Account and security emails stay with MUST. Already frozen attempts keep their original sender.'
        }
        confirmLabel={approvedActive ? 'Pause sender' : 'Activate sender'}
        reasonLabel="Reason"
        reasonRequired
        confirmDisabled={disabled || (!active && !ready)}
        onConfirm={async (reason) => {
          if (!approval) return;
          setBusy(true);
          setError('');
          try {
            await writer.current(
              `${base}/email-configuration/sending/${approval.active ? 'pause' : 'activate'}`,
              { version: approval.version, reason },
            );
            await refresh();
            writer.current = createEmailWriter();
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Sender change failed.');
            throw caught;
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
