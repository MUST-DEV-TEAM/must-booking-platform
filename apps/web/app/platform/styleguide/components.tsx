'use client';

import {
  Alert,
  Badge,
  Button,
  StatePanel,
  StatusBadge,
  statusTokenPairs,
  type StatusBadgeProps,
} from '@must/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Ban, CalendarX, Inbox, Loader2, Lock, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  libraryQueryKey,
  PropertyImageLibraryDialog,
  type LibraryImage,
} from '../../dashboard/[tenantId]/property-image-library';
import { Section, Specimen } from './specimens';
import styles from './styleguide.module.css';

function swatchImage(color: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${color}"/></svg>`,
  )}`;
}

const sampleLibrary: LibraryImage[] = [
  '#8fb5a3',
  '#c9b27c',
  '#7fa6c4',
  '#b9a1c9',
  '#9ccf9e',
  '#d9a58f',
].map((color, index) => ({
  id: `sample-${index + 1}`,
  url: swatchImage(color),
  originalName: `sample-${index + 1}.jpg`,
  usageCount: index % 3,
}));

function sampleClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchOnMount: false } },
  });
  client.setQueryData(libraryQueryKey('styleguide', 'styleguide'), sampleLibrary);
  return client;
}

const badgeTones = ['neutral', 'success', 'warning', 'danger'] as const;
const alertTones = ['info', 'success', 'warning', 'danger'] as const;
const toastKinds = ['success', 'error', 'info', 'warning'] as const;

export function Feedback() {
  const [dialog, setDialog] = useState<'multi' | 'manage' | null>(null);
  const [client] = useState(sampleClient);

  return (
    <>
      <Section
        id="badges"
        title="Badges"
        description="Neutral badges and every booking, payment and room status, each with its icon."
      >
        <Specimen title="Badge">
          <div className={styles.inlineRow}>
            {badgeTones.map((tone) => (
              <Badge key={tone} tone={tone}>
                {tone}
              </Badge>
            ))}
          </div>
        </Specimen>

        <Specimen
          title="Status badge"
          note="Every booking, payment and room state. Text carries the state; color reinforces it."
        >
          {(Object.keys(statusTokenPairs) as Array<keyof typeof statusTokenPairs>).map((domain) => (
            <div className={styles.variantRow} key={domain}>
              <span className={styles.variantLabel}>{domain}</span>
              <div className={styles.inlineRow}>
                {Object.keys(statusTokenPairs[domain]).map((state) => (
                  <StatusBadge key={state} {...({ domain, state } as StatusBadgeProps)} />
                ))}
              </div>
            </div>
          ))}
        </Specimen>
      </Section>

      <Section
        id="alerts"
        title="Alerts"
        description="Inline messages for information, success, warnings and errors."
      >
        <Specimen title="Alert">
          <div className={styles.stack}>
            {alertTones.map((tone) => (
              <Alert key={tone} tone={tone}>
                This is {tone === 'info' ? 'an' : 'a'} {tone} alert with a short explanation of what
                happened.
              </Alert>
            ))}
          </div>
        </Specimen>

        <Specimen
          title="Alert content"
          note="Alerts take any content: a title and action, or a long message that wraps."
        >
          <div className={styles.stack}>
            <Alert tone="warning">
              <strong>Payment provider unavailable.</strong> New card payments are paused until it
              recovers.
              <div className={styles.inlineRow}>
                <Button variant="secondary">View status</Button>
              </div>
            </Alert>
            <Alert tone="info">
              A long message shows how an alert wraps across several lines without losing its icon
              alignment or padding. Booking confirmations are sent to the guest and to every staff
              member assigned to the property as soon as payment completes.
            </Alert>
          </div>
        </Specimen>
      </Section>

      <Section
        id="toasts"
        title="Toasts"
        description="Transient confirmations and errors (Sonner), top-right."
      >
        <Specimen
          title="Toast"
          note="Sonner toasts. These fire the real thing in the top-right corner."
        >
          <div className={styles.inlineRow}>
            {toastKinds.map((kind) => (
              <Button
                key={kind}
                onClick={() => toast[kind](`This is a ${kind} toast.`)}
                variant="secondary"
              >
                {kind}
              </Button>
            ))}
            <Button
              onClick={() => {
                const id = toast.loading('Saving changes…');
                window.setTimeout(() => toast.success('Changes saved.', { id }), 1500);
              }}
              variant="secondary"
            >
              loading → success
            </Button>
          </div>
        </Specimen>
      </Section>

      <Section
        id="state-panels"
        title="State panels"
        description="Empty, error, loading, no-permission and not-available states for a whole region."
      >
        <Specimen
          title="State panel"
          note="Empty, error, loading, no-permission and not-available."
        >
          <div className={styles.panelGrid}>
            <StatePanel
              action={<Button variant="secondary">Add a room type</Button>}
              body="Room types you add will appear here."
              icon={<Inbox size={24} />}
              title="No room types yet"
              variant="empty"
            />
            <StatePanel
              action={<Button variant="secondary">Try again</Button>}
              body="We could not load the bookings."
              icon={<TriangleAlert size={24} />}
              title="Something went wrong"
              variant="error"
            />
            <StatePanel
              body="This usually takes a few seconds."
              icon={<Loader2 size={24} />}
              title="Loading bookings"
              variant="loading"
            />
            <StatePanel
              body="Ask an owner or admin for access."
              icon={<Lock size={24} />}
              title="You do not have access"
              variant="no-permission"
            />
            <StatePanel
              body="This feature is not enabled for this property."
              icon={<CalendarX size={24} />}
              title="Not available"
              variant="not-available"
            />
            <StatePanel
              body="Shown when a section is intentionally blocked."
              icon={<Ban size={24} />}
              title="Blocked"
              variant="not-available"
            />
          </div>
        </Specimen>
      </Section>

      <Section id="dialogs" title="Dialogs" description="Modal dialogs.">
        <Specimen
          title="Dialogs"
          note="The property photo library dialog, filled with sample photos (nothing is uploaded or deleted)."
        >
          <div className={styles.inlineRow}>
            <Button onClick={() => setDialog('multi')} variant="secondary">
              Open photo picker
            </Button>
            <Button onClick={() => setDialog('manage')} variant="secondary">
              Open library manager
            </Button>
          </div>
          {dialog ? (
            <QueryClientProvider client={client}>
              <PropertyImageLibraryDialog
                mode={dialog}
                onClose={() => setDialog(null)}
                onConfirm={() => setDialog(null)}
                propertyId="styleguide"
                tenantId="styleguide"
                title={dialog === 'multi' ? 'Add photos from the library' : 'Photo library'}
              />
            </QueryClientProvider>
          ) : null}
        </Specimen>
      </Section>
    </>
  );
}
