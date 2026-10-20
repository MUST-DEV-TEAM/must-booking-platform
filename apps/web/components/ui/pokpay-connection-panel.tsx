'use client';
import { useState } from 'react';
import { FormSection } from './form-section';
import { FormField } from './form-field';
import { Input } from './input';
import { Button } from './button';
import { Badge } from './badge';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './select';
import { Alert, AlertDescription } from './alert';
export type PokpayConnection = { id: string; status: 'PENDING' | 'CONNECTED' | 'FAILED' };
export function PokpayConnectionPanel({
  tenantId,
  propertyId,
  connection,
  assigned,
  canManage,
  onChanged,
}: {
  tenantId: string;
  propertyId: string;
  connection?: PokpayConnection;
  assigned: boolean;
  canManage: boolean;
  onChanged: () => Promise<void>;
}) {
  const [replace, setReplace] = useState(false),
    [fields, setFields] = useState({ keyId: '', merchantId: '', keySecret: '' }),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [saved, setSaved] = useState<PokpayConnection>();
  const current = saved ?? connection,
    editing = !current || replace;
  const base = `/api/tenants/${tenantId}`;
  async function send(path: string, method: string, body?: unknown) {
    const r = await fetch(base + path, {
      method,
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!r.ok) throw new Error('Could not update PokPay. Check your access and try again.');
    return r.status === 204 ? null : await r.json().catch(() => null);
  }
  async function action(kind: 'save' | 'test' | 'assign') {
    setBusy(true);
    setMessage('');
    try {
      if (kind === 'save') {
        if (!fields.keyId.trim() || !fields.merchantId.trim() || !fields.keySecret.trim()) {
          setMessage('Enter the key ID, merchant ID and secret.');
          return;
        }
        const created = await send('/integration-connections', 'POST', {
          kind: 'PAYMENT',
          provider: 'POKPAY',
          name: 'PokPay - ' + propertyId,
          credentials: {
            ...fields,
            keyId: fields.keyId.trim(),
            merchantId: fields.merchantId.trim(),
            baseUrl: 'https://api-staging.pokpay.io',
            webhookUrl: window.location.origin + '/api/webhooks/pokpay',
          },
        });
        setSaved(created);
        setFields({ keyId: '', merchantId: '', keySecret: '' });
        setReplace(false);
        setMessage('Credentials saved. Test the connection before assigning it to this hotel.');
      } else if (current && kind === 'test') {
        const tested = await send(`/integration-connections/${current.id}/test`, 'POST');
        setSaved(tested);
        setMessage(
          tested.status === 'CONNECTED'
            ? 'PokPay connected successfully.'
            : 'Could not connect to PokPay. Check the credentials and try again.',
        );
      } else if (current && kind === 'assign') {
        await send(`/properties/${propertyId}/integration-connections/${current.id}`, 'PATCH', {
          enabled: true,
        });
        setMessage('PokPay is assigned to this hotel.');
      }
      await onChanged();
    } catch {
      setMessage(
        'Could not complete this action. Check your access and connection, then try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormSection
      title="Connect PokPay"
      description="Use your hotel account to accept online payments. Credentials are never shown after saving."
    >
      <Badge variant="outline">Test</Badge>
      <p className="m-0 text-sm">
        {current?.status === 'FAILED'
          ? 'Needs attention'
          : current?.status === 'CONNECTED' && assigned && current.id === connection?.id
            ? 'Connected'
            : 'Not connected'}
      </p>
      {canManage ? (
        <>
          {editing ? (
            <>
              <FormField
                label="Mode"
                htmlFor="pokpay-mode"
                hint="Live payments are not supported by the current PokPay adapter."
              >
                <Select value="test" onValueChange={() => {}}>
                  <SelectTrigger id="pokpay-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="test">Test</SelectItem>
                    <SelectItem value="live" disabled>
                      Live - not available
                    </SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              {(['keyId', 'merchantId', 'keySecret'] as const).map((key) => (
                <FormField
                  key={key}
                  htmlFor={`pokpay-${key}`}
                  label={{ keyId: 'Key ID', merchantId: 'Merchant ID', keySecret: 'Secret' }[key]}
                >
                  <Input
                    id={`pokpay-${key}`}
                    type={key === 'keySecret' ? 'password' : 'text'}
                    autoComplete="off"
                    disabled={busy}
                    value={fields[key]}
                    onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
                  />
                </FormField>
              ))}
              <Button disabled={busy} onClick={() => void action('save')}>
                Save connection
              </Button>
            </>
          ) : (
            <>
              <p className="m-0 text-sm">Credentials: Saved</p>
              <Button variant="outline" disabled={busy} onClick={() => setReplace(true)}>
                Replace
              </Button>
            </>
          )}
          {current && !editing ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => void action('test')}>
                Test connection
              </Button>
              <Button
                disabled={busy || current.status !== 'CONNECTED'}
                onClick={() => void action('assign')}
              >
                Assign to this hotel
              </Button>
            </>
          ) : null}
        </>
      ) : null}
      {message ? (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      ) : null}
    </FormSection>
  );
}
