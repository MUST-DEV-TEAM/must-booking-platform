'use client';
import { useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { DetailList, SectionLabel } from '../../components/ui/detail-list';
import {
  createEmailWriter,
  emailRequest,
  verifiedEmailSenderSetup,
} from '../../lib/email-workspace';
import type { EmailSendingProfile } from './email-sending-profile';

export type SenderTestResult = {
  id: string;
  mode: 'SMTP' | 'RESEND';
  recipient: string;
  senderVersion: number;
  createdAt: string;
  status: string;
  messageId: string | null;
  provider: string | null;
  activationChanged: false;
};
const labels: Record<string, string> = {
  PENDING: 'Waiting to queue',
  QUEUED: 'Queued',
  SENT: 'Accepted by sending service',
  DELIVERED: 'Delivery confirmed',
  FAILED: 'Failed',
  UNKNOWN: 'Outcome unknown',
  SUPPRESSED: 'Not sent',
  EXPIRED: 'Expired',
  BOUNCED: 'Bounced',
  COMPLAINED: 'Complaint',
};
/** Tests only the actor's verified mailbox through saved custom setup, without activating or fallback. */
export function EmailSenderTest({
  base,
  profile,
  disabled,
  busy,
  setBusy,
}: {
  base: string;
  profile: EmailSendingProfile;
  disabled: boolean;
  busy: boolean;
  setBusy: (value: boolean) => void;
}) {
  const [approval, setApproval] = useState<{ version: number; mode: string } | null>(null),
    [result, setResult] = useState<SenderTestResult | null>(null),
    [error, setError] = useState('');
  const writer = useRef(createEmailWriter());
  if (profile.mode === 'DEFAULT') return null;
  const ready = verifiedEmailSenderSetup(profile);
  const href =
    result?.messageId && typeof window !== 'undefined'
      ? (() => {
          const url = new URL(window.location.href);
          url.hash = '';
          url.searchParams.set('section', 'emails');
          url.searchParams.set('emailMessageId', result.messageId!);
          return url.pathname + url.search;
        })()
      : null;
  return (
    <div className="flex flex-col gap-3">
      <SectionLabel>Test saved sender</SectionLabel>
      <p className="m-0 text-sm text-muted-foreground">
        Send one test to your own verified sign-in address. This does not activate the sender or
        fall back to MUST. Three new tests per hotel per rolling hour.
      </p>
      {!ready ? (
        <p className="m-0 text-sm text-muted-foreground">
          Verify the saved custom sender before testing it.
        </p>
      ) : null}
      <Button
        variant="outline"
        disabled={disabled || !ready}
        onClick={() => setApproval({ version: profile.version, mode: profile.mode })}
      >
        Send test to my verified address
      </Button>
      {result ? (
        <>
          <Badge
            variant={
              ['FAILED', 'UNKNOWN', 'BOUNCED', 'COMPLAINED'].includes(result.status)
                ? 'warning'
                : result.status === 'SENT' || result.status === 'DELIVERED'
                  ? 'success'
                  : 'outline'
            }
          >
            {labels[result.status] ?? result.status}
          </Badge>
          <DetailList
            stackOnMobile
            items={[
              { label: 'Test recipient', value: result.recipient },
              { label: 'Sender tested', value: result.mode === 'SMTP' ? 'SMTP' : 'Resend' },
              { label: 'Sending service', value: result.provider },
            ]}
          />
          {result.status === 'SENT' ? (
            <p className="m-0 text-sm text-muted-foreground">
              The sending service accepted this test. Inbox delivery is not confirmed.
            </p>
          ) : null}
          {result.status === 'UNKNOWN' ? (
            <Alert variant="warning">
              <AlertDescription>
                This test may have reached your inbox. Automatic retry and fallback are stopped.
                Review Delivery before creating another test.
              </AlertDescription>
            </Alert>
          ) : null}
          {['FAILED', 'SUPPRESSED', 'EXPIRED', 'BOUNCED', 'COMPLAINED'].includes(result.status) ? (
            <Alert variant="warning">
              <AlertDescription>
                Review the recorded delivery outcome before creating a new test.
              </AlertDescription>
            </Alert>
          ) : null}
          {result.senderVersion !== profile.version ? (
            <p className="m-0 text-sm text-muted-foreground">
              This result belongs to an earlier saved setup.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  setResult(
                    await emailRequest<SenderTestResult>(
                      `${base}/email-configuration/sending/tests/${result.id}`,
                    ),
                  );
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : 'Test result unavailable.');
                } finally {
                  setBusy(false);
                }
              }}
            >
              Refresh test result
            </Button>
            {href ? (
              <Button asChild variant="outline">
                <a href={href}>View test in Delivery</a>
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
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
        title="Send a custom sender test?"
        description={`One ${approval?.mode === 'SMTP' ? 'SMTP' : 'Resend'} test goes to your own verified sign-in address. Activation is unchanged. The test never falls back to MUST.`}
        confirmLabel="Send test"
        cancelLabel="Cancel"
        reasonLabel="Reason"
        reasonRequired
        confirmDisabled={disabled || !ready}
        onConfirm={async (reason) => {
          if (!approval) return;
          setBusy(true);
          setError('');
          try {
            setResult(
              await writer.current<SenderTestResult>(`${base}/email-configuration/sending/test`, {
                version: approval.version,
                reason,
              }),
            );
            writer.current = createEmailWriter();
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Test could not be requested.');
            throw caught;
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
