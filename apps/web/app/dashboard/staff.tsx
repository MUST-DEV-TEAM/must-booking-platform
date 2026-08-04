'use client';
import { Card, Heading, Stack, Text } from '@must/ui';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { DashboardLoadingSkeleton } from './loading-skeleton';
type Template = { id: string; name: string; capabilities: Array<{ key: string }> };
type Staff = {
  userId: string;
  email: string;
  roleTemplateId: string;
  roleTemplateName: string;
  overrides: Array<{ capabilityKey: string; granted: boolean }>;
};
type Usage = { plan: { maxStaffSeats: number }; usage: { staffSeats: number } };
export function DashboardStaff({ tenantId, propertyId }: { tenantId: string; propertyId: string }) {
  const base = `/api/tenants/${tenantId}`;
  const [email, setEmail] = useState('');
  const [inviteTemplateId, setInviteTemplateId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState('');
  const [templateCapabilities, setTemplateCapabilities] = useState<string[]>([]);
  const staffQuery = useQuery({
    queryKey: ['dashboard', 'staff', tenantId, propertyId],
    queryFn: async () => {
      const [staffResponse, templatesResponse, usageResponse] = await Promise.all([
        fetch(`${base}/properties/${propertyId}/staff`, { credentials: 'include' }),
        fetch(`${base}/properties/${propertyId}/role-templates`, { credentials: 'include' }),
        fetch(`${base}/plan-usage`, { credentials: 'include' }),
      ]);
      if (!staffResponse.ok || !templatesResponse.ok || !usageResponse.ok)
        throw new Error('Unable to load staff management data.');
      const [staff, templates, usage] = (await Promise.all([
        staffResponse.json(),
        templatesResponse.json(),
        usageResponse.json(),
      ])) as [Staff[], Template[], Usage];
      return {
        staff: staff.map((member) => ({ ...member, overrides: member.overrides ?? [] })),
        templates,
        usage,
      };
    },
  });
  const load = () => void staffQuery.refetch();
  if (staffQuery.isError)
    return (
      <Stack gap="sm">
        <Text tone="secondary">{staffQuery.error.message}</Text>
        <button className="must-button" onClick={load} type="button">
          Retry
        </button>
      </Stack>
    );
  if (staffQuery.isPending) return <DashboardLoadingSkeleton label="Loading staff…" />;
  const { staff, templates, usage } = staffQuery.data;
  const capped = usage.usage.staffSeats >= usage.plan.maxStaffSeats;
  const selectedInviteTemplate = inviteTemplateId || templates[0]?.id;
  const capabilityOptions =
    templates.find((template) => template.name === 'Property Manager')?.capabilities ?? [];
  async function createTemplate() {
    setBusy('template');
    const response = await fetch(`${base}/properties/${propertyId}/role-templates`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: templateName, capabilityKeys: templateCapabilities }),
    });
    if (response.ok) {
      setTemplateName('');
      setTemplateCapabilities([]);
      load();
      toast.success('Role template created.');
    } else toast.error('Unable to create role template.');
    setBusy(null);
  }
  async function invite() {
    setBusy('invite');
    const response = await fetch(`${base}/staff-invitations`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        assignments: [{ propertyId, roleTemplateId: selectedInviteTemplate }],
      }),
    });
    if (response.ok) toast.success('Invitation sent.');
    else toast.error('Unable to send invitation.');
    setBusy(null);
  }
  async function assign(userId: string, roleTemplateId: string) {
    setBusy(`assign:${userId}`);
    const response = await fetch(`${base}/properties/${propertyId}/staff/${userId}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleTemplateId }),
    });
    if (response.ok) {
      load();
      toast.success('Staff role updated.');
    } else toast.error('Unable to update staff role.');
    setBusy(null);
  }
  async function override(userId: string, key: string, value: string) {
    const url = `${base}/properties/${propertyId}/staff/${userId}/capabilities/${key}`;
    const response = await fetch(url, {
      method: value === 'default' ? 'DELETE' : 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: value === 'default' ? undefined : JSON.stringify({ granted: value === 'grant' }),
    });
    if (response.ok) {
      load();
      toast.success('Capability override updated.');
    } else toast.error('Unable to update capability override.');
  }
  return (
    <Stack gap="lg">
      <Heading>Staff</Heading>
      <Card>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Staff email" />
        <select
          aria-label="Invite role template"
          value={selectedInviteTemplate}
          onChange={(e) => setInviteTemplateId(e.target.value)}
        >
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
        <button disabled={capped || !email || busy !== null} onClick={invite}>
          {busy === 'invite' ? <Loader2 aria-hidden="true" size={16} /> : 'Invite staff'}
        </button>
        {capped ? <Text>Upgrade to unlock more staff seats.</Text> : null}
      </Card>
      <Card>
        <Heading level={2}>Create role template</Heading>
        <input
          value={templateName}
          onChange={(e) => setTemplateName(e.target.value)}
          placeholder="Template name"
        />
        {capabilityOptions.map((capability) => (
          <label key={capability.key}>
            <input
              type="checkbox"
              checked={templateCapabilities.includes(capability.key)}
              onChange={(e) =>
                setTemplateCapabilities(
                  e.target.checked
                    ? [...templateCapabilities, capability.key]
                    : templateCapabilities.filter((key) => key !== capability.key),
                )
              }
            />
            {capability.key}
          </label>
        ))}
        <button disabled={!templateName || busy !== null} onClick={createTemplate}>
          {busy === 'template' ? <Loader2 aria-hidden="true" size={16} /> : 'Create template'}
        </button>
      </Card>
      {staff.map((s) => {
        const t = templates.find((x) => x.id === s.roleTemplateId);
        return (
          <Card key={s.userId}>
            <strong>{s.email}</strong>
            <select
              disabled={busy === `assign:${s.userId}`}
              value={s.roleTemplateId}
              onChange={(e) => assign(s.userId, e.target.value)}
            >
              {templates.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            {t?.capabilities.map((c) => {
              const o = s.overrides.find((x) => x.capabilityKey === c.key);
              const state = !o ? 'default' : o.granted ? 'grant' : 'revoke';
              return (
                <label key={c.key}>
                  {c.key}
                  <select
                    aria-label={`${s.email} ${c.key}`}
                    value={state}
                    onChange={(e) => override(s.userId, c.key, e.target.value)}
                  >
                    <option value="default">Template default</option>
                    <option value="grant">Explicitly granted</option>
                    <option value="revoke">Explicitly revoked</option>
                  </select>
                </label>
              );
            })}
          </Card>
        );
      })}
    </Stack>
  );
}
