'use client';

import {
  Alert,
  Badge,
  Button,
  NavigationPagination,
  NavigationSectionTabBar,
  NavigationSectionTabItem,
  StatePanel,
  StatusBadge,
  statusTokenPairs,
  TextInput,
  type StatusBadgeProps,
} from '@must/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Ban, CalendarX, Inbox, Loader2, Lock, Search, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { DayPicker } from 'react-day-picker';
import { toast } from 'sonner';

import {
  libraryQueryKey,
  PropertyImageLibraryDialog,
  type LibraryImage,
} from '../../dashboard/[tenantId]/property-image-library';
import { interactiveStates, Section, Specimen, StateGrid } from './specimens';
import styles from './styleguide.module.css';

const buttonVariants = ['primary', 'secondary', 'danger', 'ghost'] as const;
const inputStates = [
  { label: 'Default' },
  { label: 'Hover', forced: 'hover' },
  { label: 'Focus', forced: 'focus' },
  { label: 'Disabled', disabled: true },
] as const;

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

export function FormControls() {
  const [range] = useState({ from: new Date(2026, 9, 12), to: new Date(2026, 9, 15) });

  return (
    <Section
      id="form-controls"
      title="Form controls"
      description="Hover, focus and active are forced so every state is visible at once."
    >
      <Specimen title="Button" note="Four variants from @must/ui.">
        {buttonVariants.map((variant) => (
          <div className={styles.variantRow} key={variant}>
            <span className={styles.variantLabel}>{variant}</span>
            <StateGrid
              columns={interactiveStates}
              render={(state, className) => (
                <Button className={className} disabled={state.disabled} variant={variant}>
                  {variant === 'danger' ? 'Delete' : 'Save'}
                </Button>
              )}
            />
          </div>
        ))}
      </Specimen>

      <Specimen
        title="Text input"
        note="TextInput from @must/ui: label, hint, error and adornments."
      >
        <StateGrid
          columns={inputStates}
          render={(state, className) => (
            <TextInput
              className={className}
              defaultValue="Empire Beach Resort"
              disabled={state.disabled}
              label="Property name"
            />
          )}
        />
        <div className={styles.stateGrid}>
          <div className={styles.stateCell}>
            <span className={styles.stateLabel}>Empty with placeholder</span>
            <TextInput label="Guest email" placeholder="name@example.com" />
          </div>
          <div className={styles.stateCell}>
            <span className={styles.stateLabel}>With hint</span>
            <TextInput hint="We only use this for the booking." label="Phone" />
          </div>
          <div className={styles.stateCell}>
            <span className={styles.stateLabel}>Error</span>
            <TextInput
              defaultValue="not-an-email"
              error="Enter a valid email address."
              label="Email"
            />
          </div>
          <div className={styles.stateCell}>
            <span className={styles.stateLabel}>With adornment</span>
            <TextInput
              label="Search"
              placeholder="Search bookings"
              startAdornment={<Search size={16} />}
            />
          </div>
        </div>
      </Specimen>

      <Specimen
        title="Select"
        note="There is no shared Select component; screens use a native select with the must-input class."
      >
        <StateGrid
          columns={inputStates}
          render={(state, className) => (
            <label className="must-field">
              <span className="must-field__label">Room type</span>
              <select
                className={`must-input ${className ?? ''}`}
                defaultValue="deluxe"
                disabled={state.disabled}
              >
                <option value="deluxe">Deluxe Suite Sea View</option>
                <option value="junior">Junior Suite Sea View</option>
              </select>
            </label>
          )}
        />
      </Specimen>

      <Specimen
        title="Checkbox and radio"
        note="No shared component yet; native controls are used and inherit the page font."
      >
        <div className={styles.stateGrid}>
          <label className={styles.nativeControl}>
            <input type="checkbox" /> Unchecked
          </label>
          <label className={styles.nativeControl}>
            <input type="checkbox" defaultChecked /> Checked
          </label>
          <label className={styles.nativeControl}>
            <input type="checkbox" disabled /> Disabled
          </label>
          <label className={styles.nativeControl}>
            <input name="sg-radio" type="radio" defaultChecked /> Radio selected
          </label>
          <label className={styles.nativeControl}>
            <input name="sg-radio" type="radio" /> Radio
          </label>
        </div>
      </Specimen>

      <Specimen
        title="Date range picker"
        note="react-day-picker (range mode), as used by Quick Booking and the calendar."
      >
        <DayPicker defaultMonth={new Date(2026, 9)} mode="range" selected={range} />
      </Specimen>

      <Specimen title="Section tabs and pagination" note="Navigation pieces from @must/ui.">
        <NavigationSectionTabBar label="Example tabs">
          <NavigationSectionTabItem current href="#form-controls" label="Current" />
          <NavigationSectionTabItem href="#form-controls" label="Other" />
        </NavigationSectionTabBar>
        <NavigationPagination onPageChange={() => undefined} page={2} pageSize={10} total={45} />
      </Specimen>
    </Section>
  );
}

const badgeTones = ['neutral', 'success', 'warning', 'danger'] as const;
const alertTones = ['info', 'success', 'warning', 'danger'] as const;
const toastKinds = ['success', 'error', 'info', 'warning'] as const;

export function Feedback() {
  const [dialog, setDialog] = useState<'multi' | 'manage' | null>(null);
  const [client] = useState(sampleClient);

  return (
    <Section
      id="feedback"
      title="Feedback"
      description="Badges, alerts, toasts, state panels and dialogs."
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

      <Specimen title="Alert">
        <div className={styles.stack}>
          {alertTones.map((tone) => (
            <Alert key={tone} tone={tone}>
              This is a {tone} alert with a short explanation of what happened.
            </Alert>
          ))}
        </div>
      </Specimen>

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

      <Specimen title="State panel" note="Empty, error, loading, no-permission and not-available.">
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
  );
}
