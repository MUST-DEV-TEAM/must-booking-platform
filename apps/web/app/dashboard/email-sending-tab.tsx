'use client';

import { useQuery } from '@tanstack/react-query';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { emailRequest } from '../../lib/email-workspace';
import { SenderEditor, type EmailConfigurationData } from './email-configuration';
import { SendingSummary } from './email-sending-summary';
import { EmailSendingSetup, useEmailSendingProfile } from './email-sending-profile';

/**
 * Emails, Sending: how guest emails are sent. A summary, the sender name and reply-to, and then the steps to
 * switch to the hotel's own provider (the provider's credentials themselves live in Integrations).
 */
export function EmailSendingTab({
  base,
  canWrite,
  integrationsHref,
}: {
  base: string;
  canWrite: boolean;
  integrationsHref: string;
}) {
  const profile = useEmailSendingProfile(base);
  const config = useQuery({
    queryKey: ['emails', base, 'configuration'],
    queryFn: () => emailRequest<EmailConfigurationData>(`${base}/email-configuration`),
  });
  const sender = useQuery({
    queryKey: ['emails', base, 'sender'],
    queryFn: () =>
      emailRequest<{ fromAddress: string | null; replyTo: string | null; hotelName: string }>(
        `${base}/email-sender`,
      ),
  });
  const error = config.error ?? sender.error;
  if (error)
    return (
      <ErrorPanel
        title="Sending setup unavailable"
        description={error.message}
        onRetry={() => {
          void config.refetch();
          void sender.refetch();
          void profile.refetch();
        }}
      />
    );
  if (!config.data || !sender.data || !profile.data) return <ListSkeleton />;
  const custom = profile.data.mode !== 'DEFAULT';
  return (
    <div className="flex flex-col gap-6">
      <p className="m-0 max-w-3xl text-sm text-muted-foreground">
        Who sends this hotel's guest emails and from which address. Check that your own provider is
        ready, then switch it on.
      </p>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6 lg:col-start-2 lg:row-start-1">
          <SendingSummary profile={profile.data} platformFrom={sender.data.fromAddress} />
          <SenderEditor
            key={`sender/${config.data.version}`}
            base={base}
            config={config.data}
            sender={sender.data}
            canWrite={canWrite}
            refresh={() => {
              void config.refetch();
              void sender.refetch();
            }}
          />
        </div>
        <Card className="lg:col-start-1 lg:row-start-1">
          <CardHeader>
            <CardTitle>
              {custom ? 'Your email provider' : 'Send from your own email provider'}
            </CardTitle>
            <CardDescription>
              {custom
                ? 'Follow the steps to check the connection, verify the From address and switch it on.'
                : 'Guest emails are sent by MUST today. To send them from your own address, connect a provider and go through the steps below.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EmailSendingSetup
              base={base}
              canWrite={canWrite}
              goLive
              integrationsHref={integrationsHref}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
