'use client';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../components/ui/dialog';
import { FormField } from '../../components/ui/form-field';
import { Input, Textarea } from '../../components/ui/input';
import { SegmentedControl } from '../../components/ui/segmented-control';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';

/** Where integration requests go. */
export const INTEGRATION_REQUEST_ADDRESS = 'dejvis@must.al';

export const REQUEST_CATEGORIES = [
  'Property system',
  'Payments',
  'Email',
  'Channel (booking sites)',
  'Website',
  'Restaurants',
  'Accounting',
  'Other',
] as const;

export type IntegrationRequest = {
  name: string;
  category: string;
  link: string;
  why: string;
  usesIt: 'yes' | 'no';
  urgency: 'nice' | 'soon' | 'blocking';
  details: string;
};

export const EMPTY_REQUEST: IntegrationRequest = {
  name: '',
  category: '',
  link: '',
  why: '',
  usesIt: 'no',
  urgency: 'soon',
  details: '',
};

const LIMITS = { name: 80, link: 200, why: 600, details: 500 } as const;

/** The same rules the form shows as the person types. Empty result means the request is ready. */
export function validateIntegrationRequest(values: IntegrationRequest): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = values.name.trim();
  if (name.length < 2) errors.name = 'Enter the name of the system.';
  if (!values.category) errors.category = 'Choose what kind of integration it is.';
  const link = values.link.trim();
  if (link) {
    let valid = false;
    try {
      const url = new URL(link);
      valid = url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      valid = false;
    }
    if (!valid) errors.link = 'Enter a full web address, for example https://example.com.';
  }
  if (values.why.trim().length < 10)
    errors.why = 'Tell us what you would use it for (at least 10 characters).';
  return errors;
}

const USES = { yes: 'Yes, we already use it', no: 'No, we are looking at it' } as const;
const URGENCY = {
  nice: 'Nice to have',
  soon: 'Needed soon',
  blocking: 'Urgent',
} as const;

/** The request as plain text, the same for the email body and for copying. */
export function integrationRequestText(values: IntegrationRequest): string {
  const lines = [
    'Integration request',
    '',
    `Name: ${values.name.trim()}`,
    `Category: ${values.category}`,
    values.link.trim() ? `Website: ${values.link.trim()}` : null,
    `We would use it for: ${values.why.trim()}`,
    `We already use it: ${USES[values.usesIt]}`,
    `How soon we need it: ${URGENCY[values.urgency]}`,
    values.details.trim() ? `Other details: ${values.details.trim()}` : null,
  ];
  return lines.filter((line) => line !== null).join('\n');
}

export function integrationRequestMailto(values: IntegrationRequest): string {
  return (
    `mailto:${INTEGRATION_REQUEST_ADDRESS}` +
    `?subject=${encodeURIComponent(`Integration request: ${values.name.trim()}`)}` +
    `&body=${encodeURIComponent(integrationRequestText(values))}`
  );
}

/**
 * "Need another integration?": a short form for the details the team needs. It prepares an email to the team
 * (there is no request inbox in the product yet) and can also copy the text for people without an email app.
 */
export function IntegrationRequestDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [values, setValues] = useState<IntegrationRequest>(EMPTY_REQUEST);
  const [touched, setTouched] = useState(false);
  const errors = validateIntegrationRequest(values);
  const ready = Object.keys(errors).length === 0;
  const set = <K extends keyof IntegrationRequest>(key: K, value: IntegrationRequest[K]) =>
    setValues((current) => ({ ...current, [key]: value }));
  const shown = (key: string) => (touched ? errors[key] : undefined);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogTitle>Request an integration</DialogTitle>
        <DialogDescription>
          Tell us which system you would like to connect. The more we know, the sooner we can say
          whether and when it is possible.
        </DialogDescription>
        <form
          className="space-y-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            setTouched(true);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Name of the system" htmlFor="request-name" error={shown('name')}>
              <Input
                id="request-name"
                maxLength={LIMITS.name}
                placeholder="For example Mews"
                value={values.name}
                onChange={(event) => set('name', event.target.value)}
              />
            </FormField>
            <FormField
              label="Kind of integration"
              htmlFor="request-category"
              error={shown('category')}
            >
              <Select value={values.category} onValueChange={(value) => set('category', value)}>
                <SelectTrigger id="request-category" className="w-full">
                  <SelectValue placeholder="Choose one" />
                </SelectTrigger>
                <SelectContent>
                  {REQUEST_CATEGORIES.map((category) => (
                    <SelectItem key={category} value={category}>
                      {category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <FormField
            label="Website of the system"
            htmlFor="request-link"
            hint="Optional. Where we can read about it."
            error={shown('link')}
          >
            <Input
              id="request-link"
              maxLength={LIMITS.link}
              placeholder="https://"
              value={values.link}
              onChange={(event) => set('link', event.target.value)}
            />
          </FormField>
          <FormField
            label="What would you use it for?"
            htmlFor="request-why"
            hint={`${values.why.length} / ${LIMITS.why}`}
            error={shown('why')}
          >
            <Textarea
              id="request-why"
              rows={3}
              maxLength={LIMITS.why}
              placeholder="For example: take payments, send our rooms to a booking site, keep our accounts in sync."
              value={values.why}
              onChange={(event) => set('why', event.target.value)}
            />
          </FormField>
          <FormField label="Do you already use it?">
            <SegmentedControl
              fullWidth
              label="Do you already use it?"
              value={values.usesIt}
              onChange={(value) => set('usesIt', value)}
              options={[
                { value: 'yes', label: 'Yes, we use it' },
                { value: 'no', label: 'No, not yet' },
              ]}
            />
          </FormField>
          <FormField label="How soon do you need it?">
            <SegmentedControl
              fullWidth
              label="How soon do you need it?"
              value={values.urgency}
              onChange={(value) => set('urgency', value)}
              options={[
                { value: 'nice', label: 'Nice to have' },
                { value: 'soon', label: 'Soon' },
                { value: 'blocking', label: 'Urgent' },
              ]}
            />
          </FormField>
          <FormField
            label="Anything else we should know?"
            htmlFor="request-details"
            hint={`Optional. ${values.details.length} / ${LIMITS.details}`}
          >
            <Textarea
              id="request-details"
              rows={2}
              maxLength={LIMITS.details}
              placeholder="Your plan or account type, how many hotels, deadlines…"
              value={values.details}
              onChange={(event) => set('details', event.target.value)}
            />
          </FormField>
          <p className="m-0 pt-1 text-xs text-muted-foreground">
            Send request opens your email app with everything filled in, addressed to{' '}
            {INTEGRATION_REQUEST_ADDRESS}. If no email app opens, use Copy request and send it there
            yourself.
          </p>
          <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                setTouched(true);
                if (!ready) return;
                try {
                  await navigator.clipboard.writeText(integrationRequestText(values));
                  toast.success('Request copied');
                } catch {
                  toast.error('Could not copy. Select the details and copy them by hand.');
                }
              }}
            >
              Copy request
            </Button>
            {ready ? (
              <Button asChild>
                <a
                  href={integrationRequestMailto(values)}
                  onClick={() =>
                    toast.success('Your email app should open with the request ready.')
                  }
                >
                  Send request
                </a>
              </Button>
            ) : (
              <Button type="submit">Send request</Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
