'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Input } from '../../components/ui/input';
import { FormField } from '../../components/ui/form-field';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../../components/ui/dialog';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';
import { credentialFieldsByProvider } from './[tenantId]/integrations-management';
import { ClockSyncStatus } from './clock-sync';
type Connection = {
  id: string;
  provider: 'CLOCK_PMS' | 'POKPAY' | 'STRIPE';
  name: string;
  status: string;
  lastTestedAt: string | null;
  lastTestResult: string | null;
};
export function IntegrationSettings({
  tenantId,
  propertyId,
  canWrite,
}: {
  tenantId: string;
  propertyId: string;
  canWrite: boolean;
}) {
  const base = `/api/tenants/${tenantId}`;
  const client = useQueryClient();
  const [edit, setEdit] = useState<{ provider: 'CLOCK_PMS' | 'POKPAY'; id?: string } | null>(null);
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const query = useQuery({
    queryKey: ['dashboard', 'integration-settings', tenantId, propertyId],
    queryFn: async () => {
      const [a, b] = await Promise.all([
        fetch(base + '/integration-connections', { credentials: 'include' }),
        fetch(`${base}/properties/${propertyId}/integration-connections`, {
          credentials: 'include',
        }),
      ]);
      if (!a.ok || !b.ok) throw Error('Connections could not be loaded.');
      return {
        connections: (await a.json()) as Connection[],
        assignments: (await b.json()) as Array<{ connectionId: string; enabled: boolean }>,
      };
    },
  });
  const request = async (path: string, method: string, body?: unknown) => {
    const r = await fetch(base + path, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw Error(data.message || 'Connection action could not finish.');
    return data;
  };
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const action = useMutation({
    mutationFn: async ({ path, method, body }: { path: string; method: string; body?: unknown }) =>
      request(path, method, body),
    onSuccess: async (data) => {
      if (data.status === 'FAILED')
        toast.error('Connection verification failed. Review the connection details.');
      else toast.success('Connection updated');
      await refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  const save = useMutation({
    mutationFn: async () => {
      if (!edit) return;
      const fields = credentialFieldsByProvider[edit.provider].filter(
        (f) =>
          !edit.id ||
          (edit.provider === 'CLOCK_PMS' ? ['apiUser', 'apiKey'] : ['keyId', 'keySecret']).includes(
            f.key,
          ),
      );
      const supplied = Object.fromEntries(
        fields
          .filter((f) => credentials[f.key]?.trim())
          .map((f) => [f.key, credentials[f.key].trim()]),
      );
      if (edit.id)
        await request(`/integration-connections/${edit.id}/credentials`, 'PATCH', {
          credentials: supplied,
        });
      else {
        const created = await request('/integration-connections', 'POST', {
          provider: edit.provider,
          kind: edit.provider === 'CLOCK_PMS' ? 'PMS' : 'PAYMENT',
          name,
          credentials: supplied,
        });
        const tested = await request(`/integration-connections/${created.id}/test`, 'POST');
        if (tested.status !== 'CONNECTED') {
          await refresh();
          throw Error(
            'Connection saved but verification failed. The current hotel connection was kept.',
          );
        }
        await request(`/properties/${propertyId}/integration-connections/${created.id}`, 'PATCH', {
          enabled: true,
        });
      }
    },
    onSuccess: async () => {
      setEdit(null);
      setCredentials({});
      toast.success('Connection verified and saved');
      await refresh();
    },
    onError: (e) => toast.error(e.message),
  });
  if (query.isPending) return <ListSkeleton />;
  if (query.error)
    return (
      <ErrorPanel
        title="Connections unavailable"
        description={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  const assigned = (id: string) =>
    query.data!.assignments.some((a) => a.connectionId === id && a.enabled);
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Connect this hotel's own accounts. Credentials are encrypted and never shown again. Use
        sandbox or staging accounts for testing.
      </p>
      {(['CLOCK_PMS', 'POKPAY'] as const).map((provider) => (
        <Card key={provider}>
          <CardHeader>
            <CardTitle>{provider === 'CLOCK_PMS' ? 'Clock PMS+' : 'PokPay'}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {query
              .data!.connections.filter((c) => c.provider === provider)
              .map((c) => (
                <div key={c.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>{c.name}</strong>
                    <Badge variant={assigned(c.id) ? 'success' : 'secondary'}>
                      {assigned(c.id)
                        ? 'Enabled for this hotel'
                        : c.status === 'CONNECTED'
                          ? 'Verified, not assigned'
                          : c.status}
                    </Badge>
                  </div>
                  {c.lastTestResult ? (
                    <p className="text-sm text-muted-foreground">{c.lastTestResult}</p>
                  ) : null}
                  <p className="text-sm text-muted-foreground">
                    {c.lastTestedAt
                      ? 'Last checked ' + new Date(c.lastTestedAt).toLocaleString()
                      : 'Not checked yet'}
                  </p>
                  {canWrite ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={action.isPending}
                        onClick={() =>
                          action.mutate({
                            path: `/integration-connections/${c.id}/test`,
                            method: 'POST',
                          })
                        }
                      >
                        Test connection
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setEdit({ provider, id: c.id });
                          setCredentials({});
                        }}
                      >
                        Replace credentials
                      </Button>
                      <Button
                        variant="outline"
                        disabled={action.isPending || (!assigned(c.id) && c.status !== 'CONNECTED')}
                        onClick={() =>
                          action.mutate({
                            path: `/properties/${propertyId}/integration-connections/${c.id}`,
                            method: 'PATCH',
                            body: { enabled: !assigned(c.id) },
                          })
                        }
                      >
                        {assigned(c.id) ? 'Disable for this hotel' : 'Enable for this hotel'}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            {canWrite ? (
              <Button
                variant="outline"
                onClick={() => {
                  setEdit({ provider });
                  setCredentials({});
                  setName('');
                }}
              >
                Add {provider === 'CLOCK_PMS' ? 'Clock' : 'PokPay'} connection
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ))}
      <ClockSyncStatus tenantId={tenantId} propertyId={propertyId} details />
      <Dialog
        open={!!edit}
        onOpenChange={(open) => {
          if (!open && !save.isPending) {
            setEdit(null);
            setCredentials({});
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogTitle>{edit?.id ? 'Replace credentials' : 'Add connection'}</DialogTitle>
          <DialogDescription>
            {edit?.id
              ? 'Applies to every hotel using this connection. New credentials are verified before replacing the working credentials. To change provider accounts, create a separate connection.'
              : 'A new connection is tested before assignment. Only one Clock connection can be enabled for a hotel.'}
          </DialogDescription>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            {!edit?.id ? (
              <FormField label="Connection name">
                <Input
                  required
                  maxLength={200}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </FormField>
            ) : null}
            {edit
              ? credentialFieldsByProvider[edit.provider]
                  .filter(
                    (f) =>
                      !edit.id ||
                      (edit.provider === 'CLOCK_PMS'
                        ? ['apiUser', 'apiKey']
                        : ['keyId', 'keySecret']
                      ).includes(f.key),
                  )
                  .map((f) => (
                    <FormField key={f.key} label={f.label}>
                      <Input
                        autoComplete="off"
                        type={f.secret ? 'password' : 'text'}
                        required={!edit.id}
                        value={credentials[f.key] ?? ''}
                        onChange={(e) =>
                          setCredentials({ ...credentials, [f.key]: e.target.value })
                        }
                      />
                    </FormField>
                  ))
              : null}
            {save.error ? <p role="alert">{save.error.message}</p> : null}
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Verifying...' : 'Verify and save'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
