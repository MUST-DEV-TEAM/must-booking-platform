'use client';

import { Lock } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import type { NotificationTopicSettings } from '@must/domain-contracts';

import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { SegmentedControl } from '../../components/ui/segmented-control';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { Switch } from '../../components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { createEmailWriter } from '../../lib/email-workspace';
import { GUEST_JOURNEYS, type GuestEmailItem } from './email-catalog';
import { topicBody, useNotificationSettings } from './email-notification-data';

/** The part of a wording (template) this tab needs to list it. */
export type WordingSummary = {
  key: string;
  label: string;
  hasDraft?: boolean;
  locales?: string[];
};

const languages = (templates: WordingSummary[]) =>
  [...new Set(templates.flatMap((t) => t.locales ?? ['en']))]
    .map((l) => l.toUpperCase())
    .join(' · ') || 'EN';

/**
 * Emails, Guest emails: every email a guest can receive, grouped by stage of the stay. An email opens into one place
 * with its sending settings (always sent, or a switch; its timing) above its wording.
 */
export function EmailGuestEmails<T extends WordingSummary>({
  base,
  canWrite,
  templates,
  renderEditor,
}: {
  base: string;
  canWrite: boolean;
  templates: T[];
  renderEditor: (template: T, onClose: () => void) => ReactNode;
}) {
  const { config, topics, refresh } = useNotificationSettings(base);
  const [open, setOpen] = useState<{ item: GuestEmailItem; template: string } | null>(null);
  const [busyTopic, setBusyTopic] = useState<string | null>(null);
  const [error, setError] = useState('');
  const writer = useRef(createEmailWriter());
  const failure = config.error ?? topics.error;
  if (failure)
    return (
      <ErrorPanel
        title="Guest emails unavailable"
        description={failure.message}
        onRetry={() => void refresh()}
      />
    );
  if (!config.data || !topics.data) return <ListSkeleton />;
  const topicOf = (name: string) => topics.data.topics.find((t) => t.topic === name);
  const wordings = (item: GuestEmailItem) =>
    item.templates
      .map((t) => templates.find((row) => row.key === t.key))
      .filter((row): row is T => !!row);

  const save = async (topic: NotificationTopicSettings, guestEnabled: boolean) => {
    setBusyTopic(topic.topic);
    setError('');
    try {
      await writer.current(
        `${base}/email-configuration/topics/${topic.topic}`,
        { version: config.data!.version, ...topicBody(topic, { guestEnabled }) },
        'PUT',
      );
      writer.current = createEmailWriter();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The change could not be saved.');
    } finally {
      setBusyTopic(null);
    }
  };

  if (open) {
    const topic = topicOf(open.item.topic);
    const rows = wordings(open.item);
    const current = rows.find((row) => row.key === open.template) ?? rows[0];
    const back = () => setOpen(null);
    return (
      <div className="flex flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2" onClick={back}>
            ← Guest emails
          </Button>
        </div>
        <h2 className="m-0 text-xl font-semibold">{open.item.title}</h2>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          {topic ? (
            <div className="lg:col-start-2 lg:row-start-1">
              <GuestEmailSettings
                key={`${topic.topic}/${config.data.version}`}
                item={open.item}
                topic={topic}
                base={base}
                version={config.data.version}
                canWrite={canWrite}
                onSaved={refresh}
              />
            </div>
          ) : null}
          <div className="flex min-w-0 flex-col gap-5 lg:col-start-1 lg:row-start-1">
            {rows.length > 1 ? (
              <div className="flex flex-col gap-2">
                <p className="m-0 text-sm font-semibold">Wording</p>
                <SegmentedControl
                  label="Which wording"
                  value={current?.key ?? ''}
                  onChange={(key) => setOpen({ item: open.item, template: key })}
                  options={open.item.templates.map((t) => ({ value: t.key, label: t.label }))}
                />
              </div>
            ) : null}
            {current ? (
              renderEditor(current, back)
            ) : (
              <Alert>
                <AlertDescription>The wording of this email is not available.</AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="m-0 max-w-3xl text-sm text-muted-foreground">
        Every email your guests can receive, by stage of their stay. Open one to change its wording,
        its timing and whether it is sent. Booking and payment emails are always sent, because
        guests need them.
      </p>
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {GUEST_JOURNEYS.map((journey) => (
        <section key={journey.id} aria-label={journey.title} className="flex flex-col gap-2">
          <div>
            <h3 className="m-0 text-base font-semibold">{journey.title}</h3>
            <p className="m-0 text-sm text-muted-foreground">{journey.description}</p>
          </div>
          <Card className="py-0">
            <CardContent className="p-0">
              <Table className="min-w-[42rem] table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[32%]">Email</TableHead>
                    <TableHead className="w-[32%]">Sent when</TableHead>
                    <TableHead className="w-[14%]">Languages</TableHead>
                    <TableHead className="w-[22%]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {journey.items.map((item) => {
                    const topic = topicOf(item.topic);
                    const rows = wordings(item);
                    if (!topic || !rows.length) return null;
                    const busy = busyTopic === item.topic;
                    return (
                      <TableRow key={item.topic}>
                        <TableCell className="whitespace-normal">
                          <button
                            type="button"
                            className="text-left font-medium underline-offset-4 hover:underline"
                            onClick={() => setOpen({ item, template: rows[0]!.key })}
                          >
                            {item.title}
                          </button>
                          {rows.some((row) => row.hasDraft) ? (
                            <Badge variant="muted" className="ml-2">
                              Draft waiting
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-normal text-muted-foreground">
                          {item.when(topic.daysOffset?.value ?? null)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{languages(rows)}</TableCell>
                        <TableCell>
                          {item.required && topic.guestEnabled ? (
                            <span className="inline-flex items-center gap-1.5 text-sm">
                              <Lock aria-hidden="true" className="size-3.5 text-muted-foreground" />
                              Always sent
                            </span>
                          ) : item.required ? (
                            <span className="inline-flex flex-wrap items-center gap-2">
                              <Badge variant="warning">Off</Badge>
                              {canWrite ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => void save(topic, true)}
                                >
                                  Turn on
                                </Button>
                              ) : null}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-2 text-sm">
                              <Switch
                                aria-label={`Send ${item.title}`}
                                checked={topic.guestEnabled}
                                disabled={!canWrite || busy}
                                onCheckedChange={(checked) => void save(topic, checked)}
                              />
                              {topic.guestEnabled ? 'On' : 'Off'}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </section>
      ))}
    </div>
  );
}

/** One guest email's sending settings: whether it is sent, and when. Saved with the Save button. */
function GuestEmailSettings({
  item,
  topic,
  base,
  version,
  canWrite,
  onSaved,
}: {
  item: GuestEmailItem;
  topic: NotificationTopicSettings;
  base: string;
  version: number;
  canWrite: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const [on, setOn] = useState(topic.guestEnabled);
  const [days, setDays] = useState(String(topic.daysOffset?.value ?? ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const writer = useRef(createEmailWriter());
  const range = topic.daysOffset;
  const dayCount = /^\d+$/.test(days) ? Number(days) : NaN;
  const daysError =
    range && (Number.isNaN(dayCount) || dayCount < range.min || dayCount > range.max)
      ? `Enter a whole number from ${range.min} to ${range.max}.`
      : null;
  const changed = on !== topic.guestEnabled || (range ? dayCount !== range.value : false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>When and whether it is sent</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="m-0 text-sm text-muted-foreground">
          Sent: {item.when(range ? (Number.isNaN(dayCount) ? range.value : dayCount) : null)}
        </p>
        {item.required ? (
          topic.guestEnabled ? (
            <p className="m-0 flex items-center gap-2 text-sm">
              <Lock aria-hidden="true" className="size-4 text-muted-foreground" />
              Always sent. Guests need this email, so it cannot be switched off.
            </p>
          ) : (
            <Alert variant="warning">
              <AlertDescription className="flex flex-wrap items-center gap-3">
                This email is switched off, but guests need it.
                {canWrite ? (
                  <Button size="sm" variant="outline" onClick={() => setOn(true)} disabled={on}>
                    {on ? 'Will be turned on' : 'Turn it on'}
                  </Button>
                ) : null}
              </AlertDescription>
            </Alert>
          )
        ) : (
          <label className="flex items-center gap-3 text-sm font-medium">
            <Switch checked={on} disabled={!canWrite || busy} onCheckedChange={setOn} />
            Send this email
          </label>
        )}
        {range ? (
          <FormField label={range.label} htmlFor="guest-email-days" error={daysError}>
            <Input
              id="guest-email-days"
              inputMode="numeric"
              className="max-w-40"
              value={days}
              disabled={!canWrite || busy}
              onChange={(event) => setDays(event.target.value)}
            />
          </FormField>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div>
          <Button
            disabled={!canWrite || busy || !changed || !!daysError}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await writer.current(
                  `${base}/email-configuration/topics/${topic.topic}`,
                  {
                    version,
                    ...topicBody(topic, {
                      guestEnabled: on,
                      daysOffset: range ? dayCount : undefined,
                    }),
                  },
                  'PUT',
                );
                await onSaved();
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : 'Save failed.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
