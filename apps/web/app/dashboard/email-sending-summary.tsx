'use client';

import { Badge } from '../../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { DetailList } from '../../components/ui/detail-list';
import { verifiedEmailSenderSetup } from '../../lib/email-workspace';
import { formatDateTime } from '../../lib/hotel-format';
import { onBrevo } from './brevo-setup';
import { sendingConnectionLabels, type EmailSendingProfile } from './email-sending-profile';

/** What the saved setup is called in a sentence: "your Brevo account", "your own SMTP server". */
function providerPhrase(profile: EmailSendingProfile): string {
  if (onBrevo(profile)) return 'your Brevo account';
  if (profile.mode === 'RESEND') return 'your own domain (Resend)';
  if (profile.mode === 'SMTP') return 'your own SMTP server';
  return 'the MUST system sender';
}

/**
 * How this hotel's guest emails are sent right now, in plain words: who sends, from which address, whether it is
 * switched on and whether the saved setup has been checked. It reads the same saved setup as the steps below it.
 */
export function SendingSummary({
  profile,
  platformFrom,
}: {
  profile: EmailSendingProfile;
  /** The address the MUST system sender uses, when the hotel has no switched-on sender of its own. */
  platformFrom: string | null;
}) {
  const custom = profile.mode !== 'DEFAULT';
  const active = custom && profile.activeMode === profile.mode;
  const mailbox = profile.mode === 'SMTP' || profile.mode === 'BREVO';
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>How guest emails are sent</CardTitle>
          <Badge variant={active ? 'success' : 'secondary'}>
            {active ? 'Using your own sender' : 'Using the MUST sender'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="m-0 text-sm">
          Guest emails are sent by {active ? providerPhrase(profile) : 'the MUST system sender'}.
          {custom && !active
            ? ` Your setup with ${providerPhrase(profile)} is saved but not switched on yet.`
            : ''}
        </p>
        <DetailList
          items={[
            {
              label: 'From address',
              value: custom ? (profile.fromAddress ?? 'Not set') : (platformFrom ?? 'Set by MUST'),
            },
            custom && mailbox
              ? {
                  label: 'From address verified',
                  value: profile.fromVerifiedAt
                    ? formatDateTime(profile.fromVerifiedAt)
                    : 'Not yet',
                }
              : {
                  label: 'Domain verified',
                  value: custom ? (verifiedEmailSenderSetup(profile) ? 'Yes' : 'Not yet') : null,
                },
            custom && mailbox
              ? {
                  label: 'Connection',
                  value: `${sendingConnectionLabels[profile.connectionStatus] ?? profile.connectionStatus}${
                    profile.connectionCheckedAt
                      ? ` · checked ${formatDateTime(profile.connectionCheckedAt)}`
                      : ''
                  }`,
                }
              : { label: 'Connection', value: null },
            {
              label: 'If your provider fails',
              value: custom
                ? profile.fallbackGuest
                  ? 'Guest booking and payment emails are sent through MUST instead'
                  : 'Nothing is sent'
                : null,
            },
          ]}
        />
        {active && onBrevo(profile) ? (
          <p className="m-0 text-xs text-muted-foreground">
            Delivery results from Brevo (bounces, blocks and spam reports) are not tracked here yet.
            Check them in your Brevo account.
          </p>
        ) : null}
        <p className="m-0 text-xs text-muted-foreground">
          Account and security emails, such as sign-in and invitations, always go through MUST.
        </p>
      </CardContent>
    </Card>
  );
}
