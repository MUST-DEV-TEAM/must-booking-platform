'use client';

import {
  Badge,
  Card,
  Heading,
  NavigationPagination,
  NavigationSectionTabBar,
  NavigationSectionTabItem,
  Stack,
  Text,
} from '@must/ui';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';

import styles from './email-settings.module.css';

/** The property's email settings (email plan Step 4): who gets what, wording, sender, log. */

type RecipientRule =
  | { target: 'MEMBERSHIP_ROLE'; membershipRole: 'OWNER' | 'ADMIN' }
  | { target: 'ROLE_TEMPLATE'; roleTemplateId: string }
  | { target: 'STAFF_USER'; userId: string }
  | { target: 'EMAIL'; email: string };

type TopicSettings = {
  topic: string;
  label: string;
  hasGuestEmail: boolean;
  hasStaffEmail: boolean;
  guestEnabled: boolean;
  staffEnabled: boolean;
  customStaffRecipients: boolean;
  daysOffset: { value: number; min: number; max: number; label: string } | null;
  rules: RecipientRule[];
  staffRecipients: Array<{ email: string }>;
};

type NotificationSettings = {
  topics: TopicSettings[];
  options: {
    roleTemplates: Array<{ id: string; name: string }>;
    staff: Array<{ userId: string; email: string; role: 'OWNER' | 'ADMIN' | 'STAFF' }>;
  };
};

type EmailPreferences = {
  muteOptionalEmails: boolean;
  optionalEmails: Array<{ topic: string; label: string }>;
};

type EmailTemplate = {
  key: string;
  label: string;
  language: string;
  subject: string;
  body: string;
  custom: boolean;
  defaultSubject: string;
  defaultBody: string;
  placeholders: string[];
};

type EmailSender = { fromAddress: string | null; replyTo: string | null; hotelName: string };

type EmailStatus = 'QUEUED' | 'SENT' | 'FAILED' | 'DELIVERED' | 'BOUNCED' | 'COMPLAINED';

type EmailActivityItem = {
  id: string;
  label: string;
  recipient: string;
  subject: string;
  status: EmailStatus;
  lastError: string | null;
  bookingReference: string | null;
  createdAt: string;
  canResend: boolean;
};

type EmailActivityPage = {
  items: EmailActivityItem[];
  page: number;
  pageSize: number;
  total: number;
};

export const emailTabs = [
  { key: 'recipients', label: 'Recipients' },
  { key: 'templates', label: 'Templates' },
  { key: 'sender', label: 'Sender' },
  { key: 'activity', label: 'Activity' },
] as const;

export type EmailTab = (typeof emailTabs)[number]['key'];

export function isEmailTab(value: string | null): value is EmailTab {
  return emailTabs.some((tab) => tab.key === value);
}

function settingsHref(tenantId: string, propertyId: string, area?: string) {
  const href = `/dashboard/${tenantId}?propertyId=${encodeURIComponent(propertyId)}&section=settings`;
  return area ? `${href}&settingsArea=${area}` : href;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message;
  return typeof message === 'string' && message ? message : fallback;
}

async function request<T>(url: string, fallback: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (!response.ok) throw new Error(await errorMessage(response, fallback));
  return (await response.json()) as T;
}

function SavingLabel({ pending, idle, busy }: { pending: boolean; idle: string; busy: string }) {
  return pending ? (
    <>
      <Loader2 aria-hidden="true" size={16} /> {busy}
    </>
  ) : (
    idle
  );
}

function LoadState({
  error,
  retry,
  what,
}: {
  error: Error | null;
  retry: () => void;
  what: string;
}) {
  if (!error) return <Text>Loading {what}…</Text>;
  return (
    <Card>
      <Stack gap="sm">
        <Text>{error.message}</Text>
        <button className="must-button" type="button" onClick={retry}>
          Retry
        </button>
      </Stack>
    </Card>
  );
}

export function EmailSettings({
  tenantId,
  propertyId,
  initialTab = 'recipients',
}: {
  tenantId: string;
  propertyId: string;
  initialTab?: EmailTab;
}) {
  const [tab, setTab] = useState<EmailTab>(initialTab);
  const base = `/api/tenants/${tenantId}/properties/${propertyId}`;
  const areaHref = settingsHref(tenantId, propertyId, 'email');

  return (
    <Stack gap="lg">
      <a className={styles.backLink} href={settingsHref(tenantId, propertyId)}>
        Back to Settings overview
      </a>
      <Heading level={1}>Emails</Heading>
      <NavigationSectionTabBar label="Email settings">
        {emailTabs.map((item) => (
          <NavigationSectionTabItem
            current={tab === item.key}
            href={`${areaHref}&emailTab=${item.key}`}
            key={item.key}
            label={item.label}
            onSelect={() => setTab(item.key)}
          />
        ))}
      </NavigationSectionTabBar>
      {tab === 'recipients' ? <RecipientsTab tenantId={tenantId} base={base} /> : null}
      {tab === 'templates' ? <TemplatesTab base={base} /> : null}
      {tab === 'sender' ? (
        <SenderTab base={base} brandingHref={settingsHref(tenantId, propertyId, 'branding')} />
      ) : null}
      {tab === 'activity' ? <ActivityTab base={base} /> : null}
    </Stack>
  );
}

/* ----------------------------- Recipients ----------------------------- */

function RecipientsTab({ tenantId, base }: { tenantId: string; base: string }) {
  const query = useQuery({
    queryKey: ['dashboard', 'email', 'recipients', base],
    queryFn: () =>
      request<NotificationSettings>(
        `${base}/notification-settings`,
        'Unable to load email recipients.',
      ),
  });

  if (!query.data)
    return (
      <LoadState error={query.error} retry={() => void query.refetch()} what="email recipients" />
    );
  const { topics, options } = query.data;
  return (
    <Stack gap="lg">
      <Text tone="secondary">
        Choose which emails this property sends, and which staff get each one. New emails start
        turned off until you turn them on.
      </Text>
      {topics.map((topic) => (
        <TopicCard base={base} key={topic.topic} options={options} topic={topic} />
      ))}
      <MyEmailsCard tenantId={tenantId} />
    </Stack>
  );
}

function ruleKey(rule: RecipientRule): string {
  switch (rule.target) {
    case 'MEMBERSHIP_ROLE':
      return `role:${rule.membershipRole}`;
    case 'ROLE_TEMPLATE':
      return `template:${rule.roleTemplateId}`;
    case 'STAFF_USER':
      return `user:${rule.userId}`;
    case 'EMAIL':
      return `email:${rule.email}`;
  }
}

function ruleLabel(rule: RecipientRule, options: NotificationSettings['options']): string {
  switch (rule.target) {
    case 'MEMBERSHIP_ROLE':
      return rule.membershipRole === 'OWNER' ? 'All owners' : 'All admins';
    case 'ROLE_TEMPLATE':
      return `Everyone with the role "${
        options.roleTemplates.find((role) => role.id === rule.roleTemplateId)?.name ?? 'Unknown'
      }"`;
    case 'STAFF_USER':
      return options.staff.find((member) => member.userId === rule.userId)?.email ?? 'Unknown';
    case 'EMAIL':
      return rule.email;
  }
}

function TopicCard({
  base,
  topic,
  options,
}: {
  base: string;
  topic: TopicSettings;
  options: NotificationSettings['options'];
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(topic);
  const [newRule, setNewRule] = useState('');
  const [newEmail, setNewEmail] = useState('');
  useEffect(() => setDraft(topic), [topic]);

  const save = useMutation({
    mutationFn: () =>
      request<TopicSettings>(
        `${base}/notification-settings/${topic.topic}`,
        'Unable to save this email.',
        {
          method: 'PUT',
          body: JSON.stringify({
            guestEnabled: draft.guestEnabled,
            staffEnabled: draft.staffEnabled,
            customStaffRecipients: draft.customStaffRecipients,
            rules: draft.customStaffRecipients ? draft.rules : [],
            ...(draft.daysOffset ? { daysOffset: draft.daysOffset.value } : {}),
          }),
        },
      ),
    onSuccess: (updated) => {
      queryClient.setQueryData<NotificationSettings>(
        ['dashboard', 'email', 'recipients', base],
        (current) =>
          current
            ? {
                ...current,
                topics: current.topics.map((item) =>
                  item.topic === updated.topic ? updated : item,
                ),
              }
            : current,
      );
      toast.success(`${topic.label} saved.`);
    },
    onError: (error) => toast.error(error.message),
  });

  function addRule() {
    let rule: RecipientRule | null = null;
    if (newRule === 'role:OWNER') rule = { target: 'MEMBERSHIP_ROLE', membershipRole: 'OWNER' };
    else if (newRule === 'role:ADMIN')
      rule = { target: 'MEMBERSHIP_ROLE', membershipRole: 'ADMIN' };
    else if (newRule.startsWith('template:'))
      rule = { target: 'ROLE_TEMPLATE', roleTemplateId: newRule.slice('template:'.length) };
    else if (newRule.startsWith('user:'))
      rule = { target: 'STAFF_USER', userId: newRule.slice('user:'.length) };
    else if (newRule === 'email' && newEmail.trim())
      rule = { target: 'EMAIL', email: newEmail.trim().toLowerCase() };
    if (!rule || draft.rules.some((existing) => ruleKey(existing) === ruleKey(rule))) return;
    setDraft({ ...draft, rules: [...draft.rules, rule] });
    setNewRule('');
    setNewEmail('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    save.mutate();
  }

  const id = `email-topic-${topic.topic}`;
  return (
    <Card>
      <form className="must-stack must-stack--md" aria-labelledby={id} onSubmit={submit}>
        <Heading level={2}>
          <span id={id}>{topic.label}</span>
        </Heading>
        {topic.hasGuestEmail ? (
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={draft.guestEnabled}
              onChange={(event) => setDraft({ ...draft, guestEnabled: event.target.checked })}
            />
            <span>Email the guest</span>
          </label>
        ) : null}
        {draft.daysOffset ? (
          <label className="must-field">
            <span className="must-field__label">{draft.daysOffset.label}</span>
            <input
              className="must-input"
              type="number"
              min={draft.daysOffset.min}
              max={draft.daysOffset.max}
              value={draft.daysOffset.value}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  daysOffset: { ...draft.daysOffset!, value: Number(event.target.value) },
                })
              }
            />
          </label>
        ) : null}
        {topic.hasStaffEmail ? (
          <>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={draft.staffEnabled}
                onChange={(event) => setDraft({ ...draft, staffEnabled: event.target.checked })}
              />
              <span>Email staff</span>
            </label>
            {draft.staffEnabled ? (
              <fieldset className={styles.fieldset}>
                <legend className="must-field__label">Which staff</legend>
                <label className={styles.toggle}>
                  <input
                    type="radio"
                    name={`${id}-who`}
                    checked={!draft.customStaffRecipients}
                    onChange={() => setDraft({ ...draft, customStaffRecipients: false })}
                  />
                  <span>The usual people (the default for this email)</span>
                </label>
                <label className={styles.toggle}>
                  <input
                    type="radio"
                    name={`${id}-who`}
                    checked={draft.customStaffRecipients}
                    onChange={() => setDraft({ ...draft, customStaffRecipients: true })}
                  />
                  <span>Only the people I choose</span>
                </label>
                {draft.customStaffRecipients ? (
                  <Stack gap="sm">
                    {draft.rules.length ? (
                      <ul className={styles.ruleList}>
                        {draft.rules.map((rule) => (
                          <li key={ruleKey(rule)}>
                            <span>{ruleLabel(rule, options)}</span>
                            <button
                              className="must-button must-button--secondary"
                              type="button"
                              onClick={() =>
                                setDraft({
                                  ...draft,
                                  rules: draft.rules.filter(
                                    (existing) => ruleKey(existing) !== ruleKey(rule),
                                  ),
                                })
                              }
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <Text tone="secondary">Nobody yet. Add people below.</Text>
                    )}
                    <div className={styles.addRule}>
                      <select
                        aria-label={`Add a recipient for ${topic.label}`}
                        className="must-input"
                        value={newRule}
                        onChange={(event) => setNewRule(event.target.value)}
                      >
                        <option value="">Add…</option>
                        <option value="role:OWNER">All owners</option>
                        <option value="role:ADMIN">All admins</option>
                        {options.roleTemplates.map((role) => (
                          <option key={role.id} value={`template:${role.id}`}>
                            Role: {role.name}
                          </option>
                        ))}
                        {options.staff.map((member) => (
                          <option key={member.userId} value={`user:${member.userId}`}>
                            Person: {member.email}
                          </option>
                        ))}
                        <option value="email">Another email address…</option>
                      </select>
                      {newRule === 'email' ? (
                        <input
                          aria-label="Email address"
                          className="must-input"
                          type="email"
                          placeholder="reception@yourhotel.com"
                          value={newEmail}
                          onChange={(event) => setNewEmail(event.target.value)}
                        />
                      ) : null}
                      <button
                        className="must-button must-button--secondary"
                        type="button"
                        disabled={!newRule || (newRule === 'email' && !newEmail.trim())}
                        onClick={addRule}
                      >
                        Add
                      </button>
                    </div>
                  </Stack>
                ) : null}
                <Text tone="secondary">
                  {topic.staffRecipients.length
                    ? `Goes to now: ${topic.staffRecipients.map((r) => r.email).join(', ')}`
                    : 'Nobody gets this email right now.'}
                </Text>
              </fieldset>
            ) : null}
          </>
        ) : null}
        <button className="must-button must-button--primary" disabled={save.isPending}>
          <SavingLabel pending={save.isPending} idle={`Save ${topic.label}`} busy="Saving…" />
        </button>
      </form>
    </Card>
  );
}

function MyEmailsCard({ tenantId }: { tenantId: string }) {
  const url = `/api/tenants/${tenantId}/my-email-preferences`;
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['dashboard', 'email', 'preferences', tenantId],
    queryFn: () => request<EmailPreferences>(url, 'Unable to load your email preferences.'),
  });
  const save = useMutation({
    mutationFn: (muteOptionalEmails: boolean) =>
      request<EmailPreferences>(url, 'Unable to save your email preferences.', {
        method: 'PUT',
        body: JSON.stringify({ muteOptionalEmails }),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['dashboard', 'email', 'preferences', tenantId], updated);
      toast.success('Your email preferences were saved.');
    },
    onError: (error) => toast.error(error.message),
  });
  if (!query.data) return null;
  return (
    <Card>
      <Stack gap="md">
        <Heading level={2}>My emails</Heading>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={query.data.muteOptionalEmails}
            disabled={save.isPending}
            onChange={(event) => save.mutate(event.target.checked)}
          />
          <span>Don&apos;t send me non-urgent emails</span>
        </label>
        <Text tone="secondary">
          Applies only to you, in every property of this account. Non-urgent emails:{' '}
          {query.data.optionalEmails.map((item) => item.label).join(', ')}. Urgent alerts always
          arrive.
        </Text>
      </Stack>
    </Card>
  );
}

/* ----------------------------- Templates ----------------------------- */

function TemplatesTab({ base }: { base: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['dashboard', 'email', 'templates', base];
  const query = useQuery({
    queryKey,
    queryFn: () => request<EmailTemplate[]>(`${base}/email-templates`, 'Unable to load templates.'),
  });
  const [key, setKey] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const selected = query.data?.find((item) => item.key === (key ?? query.data?.[0]?.key));

  useEffect(() => {
    if (!selected) return;
    setSubject(selected.subject);
    setBody(selected.body);
    setPreview(null);
  }, [selected]);

  function replace(updated: EmailTemplate) {
    queryClient.setQueryData<EmailTemplate[]>(queryKey, (current) =>
      current?.map((item) => (item.key === updated.key ? updated : item)),
    );
  }

  const save = useMutation({
    mutationFn: () =>
      request<EmailTemplate>(`${base}/email-templates/${selected!.key}`, 'Unable to save.', {
        method: 'PUT',
        body: JSON.stringify({ subject, body }),
      }),
    onSuccess: (updated) => {
      replace(updated);
      toast.success('Template saved.');
    },
    onError: (error) => toast.error(error.message),
  });
  const reset = useMutation({
    mutationFn: () =>
      request<EmailTemplate>(`${base}/email-templates/${selected!.key}`, 'Unable to reset.', {
        method: 'DELETE',
      }),
    onSuccess: (updated) => {
      replace(updated);
      toast.success('Back to the default wording.');
    },
    onError: (error) => toast.error(error.message),
  });
  const showPreview = useMutation({
    mutationFn: () =>
      request<{ subject: string; html: string }>(
        `${base}/email-templates/${selected!.key}/preview`,
        'Unable to preview.',
        { method: 'POST', body: JSON.stringify({ subject, body }) },
      ),
    onSuccess: setPreview,
    onError: (error) => toast.error(error.message),
  });
  const sendTest = useMutation({
    mutationFn: () =>
      request<{ sentTo: string }>(
        `${base}/email-templates/${selected!.key}/test`,
        'Unable to send a test.',
        { method: 'POST', body: JSON.stringify({ subject, body }) },
      ),
    onSuccess: (result) => toast.success(`Test email sent to ${result.sentTo}.`),
    onError: (error) => toast.error(error.message),
  });

  if (!query.data || !selected)
    return <LoadState error={query.error} retry={() => void query.refetch()} what="templates" />;
  const changed = subject !== selected.subject || body !== selected.body;

  return (
    <Stack gap="lg">
      <Text tone="secondary">
        Change the subject and message of guest emails. Your logo, the booking details and the
        footer are added automatically. Placeholders in curly brackets are filled in for each guest.
      </Text>
      <Card>
        <form
          className="must-stack must-stack--md"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <label className="must-field">
            <span className="must-field__label">Email</span>
            <select
              className="must-input"
              value={selected.key}
              onChange={(event) => setKey(event.target.value)}
            >
              {query.data.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                  {item.custom ? ' (edited)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="must-field">
            <span className="must-field__label">Subject</span>
            <input
              className="must-input"
              required
              maxLength={300}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </label>
          <label className="must-field">
            <span className="must-field__label">Message</span>
            <textarea
              className={`must-input ${styles.messageInput}`}
              required
              maxLength={5000}
              rows={8}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </label>
          <Text tone="secondary">
            Leave an empty line to start a new paragraph. You can use:{' '}
            {selected.placeholders.map((name) => `{${name}}`).join(' ')}
          </Text>
          <div className={styles.actions}>
            <button
              className="must-button must-button--primary"
              disabled={save.isPending || !changed}
            >
              <SavingLabel pending={save.isPending} idle="Save template" busy="Saving…" />
            </button>
            <button
              className="must-button must-button--secondary"
              type="button"
              disabled={showPreview.isPending}
              onClick={() => showPreview.mutate()}
            >
              Preview
            </button>
            <button
              className="must-button must-button--secondary"
              type="button"
              disabled={sendTest.isPending}
              onClick={() => sendTest.mutate()}
            >
              <SavingLabel pending={sendTest.isPending} idle="Send me a test" busy="Sending…" />
            </button>
            {selected.custom ? (
              <button
                className="must-button must-button--secondary"
                type="button"
                disabled={reset.isPending}
                onClick={() => {
                  if (window.confirm('Go back to the default wording for this email?'))
                    reset.mutate();
                }}
              >
                Reset to default
              </button>
            ) : null}
          </div>
        </form>
      </Card>
      {preview ? (
        <Card>
          <Stack gap="sm">
            <Heading level={2}>Preview</Heading>
            <Text>
              <strong>Subject:</strong> {preview.subject}
            </Text>
            <iframe
              className={styles.preview}
              sandbox=""
              srcDoc={preview.html}
              title="Email preview"
            />
          </Stack>
        </Card>
      ) : null}
      <ReviewLinksCard base={base} />
    </Stack>
  );
}

type ReviewLinks = {
  links: Record<string, string>;
  sites: Array<{ key: string; label: string }>;
};

function ReviewLinksCard({ base }: { base: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['dashboard', 'email', 'review-links', base];
  const query = useQuery({
    queryKey,
    queryFn: () => request<ReviewLinks>(`${base}/review-links`, 'Unable to load review links.'),
  });
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => {
    if (query.data) setDraft(query.data.links);
  }, [query.data]);
  const save = useMutation({
    mutationFn: () =>
      request<ReviewLinks>(`${base}/review-links`, 'Unable to save the review links.', {
        method: 'PUT',
        body: JSON.stringify(draft),
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKey, updated);
      toast.success('Review links saved.');
    },
    onError: (error) => toast.error(error.message),
  });
  if (!query.data) return null;
  return (
    <Card>
      <form
        className="must-stack must-stack--md"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Heading level={2}>Review links</Heading>
        <Text tone="secondary">
          The post-stay thank-you shows a button for each link you add. Every guest gets the same
          links: Google and the big review sites don&apos;t allow sending only happy guests to
          public reviews.
        </Text>
        {query.data.sites.map((site) => (
          <label className="must-field" key={site.key}>
            <span className="must-field__label">{site.label}</span>
            <input
              className="must-input"
              type="url"
              placeholder="https://"
              value={draft[site.key] ?? ''}
              onChange={(event) => setDraft({ ...draft, [site.key]: event.target.value })}
            />
          </label>
        ))}
        <button className="must-button must-button--primary" disabled={save.isPending}>
          <SavingLabel pending={save.isPending} idle="Save review links" busy="Saving…" />
        </button>
      </form>
    </Card>
  );
}

/* ------------------------------- Sender ------------------------------- */

function SenderTab({ base, brandingHref }: { base: string; brandingHref: string }) {
  const query = useQuery({
    queryKey: ['dashboard', 'email', 'sender', base],
    queryFn: () => request<EmailSender>(`${base}/email-sender`, 'Unable to load the sender.'),
  });
  if (!query.data)
    return <LoadState error={query.error} retry={() => void query.refetch()} what="the sender" />;
  const sender = query.data;
  return (
    <Card>
      <Stack gap="md">
        <Heading level={2}>Who your emails come from</Heading>
        <dl className={styles.details}>
          <dt>Sent from</dt>
          <dd>{sender.fromAddress ?? 'Not set up on the server yet'}</dd>
          <dt>Replies go to</dt>
          <dd>
            {sender.replyTo ?? 'Nowhere yet: add a support email so guests can reply to you.'}
          </dd>
        </dl>
        <a className="must-button must-button--secondary" href={brandingHref}>
          Change the reply address in Branding
        </a>
        <Text tone="secondary">
          Coming soon: guest emails will show {sender.hotelName} as the sender name, and you will be
          able to send from your own address, such as bookings@yourhotel.com, after adding a few DNS
          records to your domain.
        </Text>
      </Stack>
    </Card>
  );
}

/* ------------------------------ Activity ------------------------------ */

const STATUS: Record<
  EmailStatus,
  { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }
> = {
  QUEUED: { label: 'Sending', tone: 'neutral' },
  SENT: { label: 'Sent', tone: 'success' },
  DELIVERED: { label: 'Delivered', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  BOUNCED: { label: 'Bounced', tone: 'danger' },
  COMPLAINED: { label: 'Marked as spam', tone: 'warning' },
};

const ACTIVITY_PAGE_SIZE = 25;

function ActivityTab({ base }: { base: string }) {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'all' | 'problems'>('all');
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['dashboard', 'email', 'activity', base, filter, page],
    queryFn: () =>
      request<EmailActivityPage>(
        `${base}/email-activity?filter=${filter}&page=${page}&pageSize=${ACTIVITY_PAGE_SIZE}`,
        'Unable to load the email activity.',
      ),
    placeholderData: keepPreviousData,
  });
  const resend = useMutation({
    mutationFn: (id: string) =>
      request<{ status: string }>(
        `${base}/email-activity/${id}/resend`,
        'Unable to send this email again.',
        { method: 'POST' },
      ),
    onSuccess: () => {
      toast.success('Sending the email again.');
      void queryClient.invalidateQueries({ queryKey: ['dashboard', 'email', 'activity', base] });
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <Stack gap="lg">
      <div className={styles.activityHeader}>
        <Text tone="secondary">Every email this property sent, newest first.</Text>
        <label className="must-field">
          <span className="must-field__label">Show</span>
          <select
            className="must-input"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value as 'all' | 'problems');
              setPage(1);
            }}
          >
            <option value="all">All emails</option>
            <option value="problems">Only problems</option>
          </select>
        </label>
      </div>
      {!query.data ? (
        <LoadState error={query.error} retry={() => void query.refetch()} what="email activity" />
      ) : (
        <Card>
          {query.data.items.length ? (
            <ul className={styles.activityList}>
              {query.data.items.map((item) => (
                <li key={item.id}>
                  <div className={styles.activityMain}>
                    <strong>{item.subject}</strong>
                    <span>
                      {item.label} · to {item.recipient}
                      {item.bookingReference ? ` · ${item.bookingReference}` : ''}
                    </span>
                    {item.lastError && item.status !== 'SENT' && item.status !== 'DELIVERED' ? (
                      <span className={styles.activityError}>{item.lastError}</span>
                    ) : null}
                  </div>
                  <div className={styles.activitySide}>
                    <Badge tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Badge>
                    <time dateTime={item.createdAt}>
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(item.createdAt))}
                    </time>
                    {item.canResend ? (
                      <button
                        className="must-button must-button--secondary"
                        type="button"
                        disabled={resend.isPending}
                        onClick={() => resend.mutate(item.id)}
                      >
                        Send again
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Text>
              {filter === 'problems' ? 'No problems. Every email went out.' : 'No emails yet.'}
            </Text>
          )}
          <NavigationPagination
            label="Email activity pages"
            onPageChange={setPage}
            page={query.data.page}
            pageSize={query.data.pageSize}
            total={query.data.total}
          />
        </Card>
      )}
    </Stack>
  );
}
