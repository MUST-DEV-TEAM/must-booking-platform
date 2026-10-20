'use client';
import { useRef, useState } from 'react';
import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { CopyButton } from '../../components/ui/copy-button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { createEmailWriter, emailRequest } from '../../lib/email-workspace';

export type EmailDnsRecord = {
  record: string;
  type: string;
  name: string;
  value: string;
  status: string;
  ttl: string | number;
  priority?: number;
};
export type EmailDmarcEvidence = {
  name: string;
  type: 'TXT';
  state: 'published' | 'absent' | 'invalid' | 'unknown';
  values: string[];
  observedAt: string;
  message: string;
};
export function validEmailDmarc(value: unknown): value is EmailDmarcEvidence | null {
  if (value === null) return true;
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.name === 'string' &&
    row.type === 'TXT' &&
    typeof row.state === 'string' &&
    ['published', 'absent', 'invalid', 'unknown'].includes(row.state) &&
    Array.isArray(row.values) &&
    row.values.length <= 5 &&
    row.values.every((v) => typeof v === 'string' && v.length <= 8192) &&
    typeof row.observedAt === 'string' &&
    Number.isFinite(Date.parse(row.observedAt)) &&
    typeof row.message === 'string'
  );
}
export type EmailDomainOperation = {
  id: string;
  kind: 'DOMAIN_CHECK';
  state: string;
  version: number;
  domain: string;
  records: EmailDnsRecord[];
  message: string;
  dmarc?: EmailDmarcEvidence | null;
};
export function validEmailDnsRecords(value: unknown): value is EmailDnsRecord[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (row) =>
        row &&
        typeof row === 'object' &&
        ['record', 'type', 'name', 'value', 'status'].every((k) => typeof row[k] === 'string') &&
        (typeof row.ttl === 'string' || typeof row.ttl === 'number') &&
        (row.priority === undefined ||
          (typeof row.priority === 'number' && Number.isSafeInteger(row.priority))),
    )
  );
}

/** Shows actual provider DNS evidence and confirms separate check/registration actions. */
export function EmailDomainSetup({
  base,
  version,
  mode,
  status,
  records = [],
  dmarc,
  disabled,
  busy,
  setBusy,
  result,
  onResult,
  refresh,
}: {
  base: string;
  version: number;
  mode: 'DEFAULT' | 'RESEND';
  status: string;
  records?: EmailDnsRecord[];
  dmarc?: EmailDmarcEvidence | null;
  disabled: boolean;
  busy: boolean;
  setBusy: (value: boolean) => void;
  result: EmailDomainOperation | null;
  onResult: (result: EmailDomainOperation) => void;
  refresh: () => Promise<unknown>;
}) {
  const [approval, setApproval] = useState<'check' | 'register' | null>(null),
    [error, setError] = useState('');
  const writer = useRef(createEmailWriter());
  const observed = result?.version === version ? result : null;
  const currentRecords = observed?.records ?? records;
  const currentDmarc = observed?.dmarc ?? dmarc;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Sending-domain DNS</span>
        <Badge variant="outline">
          {status === 'verified'
            ? 'Provider verified'
            : status === 'pending'
              ? 'DNS pending'
              : status === 'not_found'
                ? 'Domain not found'
                : 'No current verified evidence'}
        </Badge>
      </div>
      <p className="m-0 text-sm text-muted-foreground">
        {mode === 'DEFAULT'
          ? 'Reads the shared MUST sender domain only. Hotel staff cannot register it or change its provider settings.'
          : 'Publish the exact records from Resend in your domain’s DNS. Checking asks Resend to verify them; it does not activate custom sending.'}
      </p>
      {observed?.domain || currentDmarc?.name ? (
        <p className="m-0 text-sm">
          Checked domain: {observed?.domain ?? currentDmarc?.name.replace(/^_dmarc\./, '')}
        </p>
      ) : null}
      {currentRecords.length ? (
        <Table className="min-w-[60rem]">
          <TableHeader>
            <TableRow>
              <TableHead>Purpose</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Value</TableHead>
              <TableHead>TTL / priority</TableHead>
              <TableHead>Provider status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {currentRecords.map((record, index) => (
              <TableRow key={`${record.name}/${record.type}/${index}`}>
                <TableCell>{record.record}</TableCell>
                <TableCell>{record.type}</TableCell>
                <TableCell className="max-w-[18rem] whitespace-normal">
                  <span className="break-all">{record.name}</span>
                  <CopyButton label={`Copy DNS name ${index + 1}`} value={record.name} />
                </TableCell>
                <TableCell className="min-w-48 max-w-[28rem] whitespace-normal">
                  <span className="break-all">{record.value}</span>
                  <CopyButton label={`Copy DNS value ${index + 1}`} value={record.value} />
                </TableCell>
                <TableCell>
                  {record.ttl}
                  {record.priority !== undefined ? ` / ${record.priority}` : ''}
                </TableCell>
                <TableCell>{record.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
      {currentRecords.length ? (
        <p className="m-0 text-xs text-muted-foreground sm:hidden">
          Scroll the table sideways to see each DNS value and status.
        </p>
      ) : null}
      {currentDmarc ? (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">DMARC publication</span>
            <Badge variant="outline">
              {currentDmarc.state === 'published'
                ? 'Published at this name'
                : currentDmarc.state === 'absent'
                  ? 'No TXT at this name'
                  : currentDmarc.state === 'invalid'
                    ? 'Review DNS records'
                    : 'DNS check unavailable'}
            </Badge>
          </div>
          <p className="m-0 text-sm text-muted-foreground">{currentDmarc.message}</p>
          <div className="flex items-center gap-2 text-sm">
            <span className="break-all">TXT · {currentDmarc.name}</span>
            <CopyButton label="Copy DMARC name" value={currentDmarc.name} />
          </div>
          {currentDmarc.values.map((value, index) => (
            <div key={index} className="flex items-start gap-2 text-sm">
              <span className="break-all">{value}</span>
              <CopyButton label={`Copy DMARC value ${index + 1}`} value={value} />
            </div>
          ))}
          {mode === 'RESEND' && currentDmarc.state === 'absent' ? (
            <p className="m-0 text-xs text-muted-foreground">
              Optional monitoring example: v=DMARC1; p=none;. Check any parent policy first; do not
              replace an existing policy or add a duplicate.
            </p>
          ) : null}
          <a
            className="text-sm underline"
            href="https://resend.com/blog/how-dmarc-applies-to-subdomains"
            target="_blank"
            rel="noreferrer"
          >
            Review DMARC setup guidance
          </a>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={disabled} onClick={() => setApproval('check')}>
          {mode === 'DEFAULT' ? 'Check MUST sender domain' : 'Check saved domain'}
        </Button>
        {mode === 'RESEND' && observed?.state === 'not_found' ? (
          <Button disabled={disabled} onClick={() => setApproval('register')}>
            Register domain in Resend
          </Button>
        ) : null}
        {result ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const response = await emailRequest<EmailDomainOperation>(
                  base + '/email-configuration/sending/domain/operations/' + result.id,
                );
                if (
                  !validEmailDnsRecords(response.records) ||
                  (response.dmarc !== undefined && !validEmailDmarc(response.dmarc))
                )
                  throw Error('Invalid domain evidence. Reload before continuing.');
                onResult(response);
              } catch (caught) {
                setError(caught instanceof Error ? caught.message : 'Domain evidence unavailable.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Refresh domain operation
          </Button>
        ) : null}
        {mode === 'DEFAULT' ? (
          <a className="text-sm underline" href="mailto:support@mustbooking.com">
            Contact platform support
          </a>
        ) : (
          <a
            className="text-sm underline"
            href="https://resend.com/domains"
            target="_blank"
            rel="noreferrer"
          >
            Open Resend domains
          </a>
        )}
      </div>
      {result ? (
        <Alert
          variant={
            ['failed', 'unknown', 'stale'].includes(result.state) ? 'destructive' : 'default'
          }
        >
          <AlertDescription>
            {observed
              ? result.message
              : 'Sender setup changed. Run a new check for the saved domain.'}
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <ConfirmDialog
        open={!!approval}
        onOpenChange={(open) => {
          if (!open) setApproval(null);
        }}
        title={
          approval === 'register'
            ? 'Register this sending domain?'
            : 'Check the saved sending domain?'
        }
        description={
          approval === 'register'
            ? 'Creates this exact domain in your connected Resend account in the EU region, with receiving and tracking disabled. Current delivery stays unchanged.'
            : mode === 'DEFAULT'
              ? 'Reads shared MUST provider evidence. No domain or sending settings are changed.'
              : 'Reads the saved domain and asks Resend to recheck DNS. Current delivery stays unchanged.'
        }
        confirmLabel={approval === 'register' ? 'Register domain' : 'Check domain'}
        cancelLabel="Cancel"
        reasonLabel="Reason"
        reasonRequired
        reasonPlaceholder="Why you are checking or registering this domain"
        confirmDisabled={disabled}
        onConfirm={async (reason) => {
          setBusy(true);
          setError('');
          try {
            const response = await writer.current<EmailDomainOperation>(
              base + '/email-configuration/sending/domain/check',
              { version, reason, allowCreate: approval === 'register' },
            );
            if (
              !validEmailDnsRecords(response.records) ||
              (response.dmarc !== undefined && !validEmailDmarc(response.dmarc))
            )
              throw Error('Invalid domain evidence. Reload before continuing.');
            onResult(response);
            await refresh();
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}
