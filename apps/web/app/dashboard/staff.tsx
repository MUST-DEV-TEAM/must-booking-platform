'use client';
import { Card, Heading, Stack, Text } from '@must/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DashboardLoadingSkeleton } from './loading-skeleton';
import styles from './data-table.module.css';
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
  const { staff = [], templates = [], usage } = staffQuery.data ?? {};
  const capped = usage ? usage.usage.staffSeats >= usage.plan.maxStaffSeats : false;
  const selectedInviteTemplate = inviteTemplateId || templates[0]?.id;
  const capabilityOptions =
    templates.find((template) => template.name === 'Property Manager')?.capabilities ?? [];
  const inviteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${base}/staff-invitations`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          assignments: [{ propertyId, roleTemplateId: selectedInviteTemplate }],
        }),
      });
      if (!response.ok) throw new Error();
    },
    onSuccess: () => toast.success('Invitation sent.'),
    onError: () => toast.error('Unable to send invitation.'),
  });
  const createTemplateMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${base}/properties/${propertyId}/role-templates`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: templateName, capabilityKeys: templateCapabilities }),
      });
      if (!response.ok) throw new Error();
    },
    onSuccess: () => {
      setTemplateName('');
      setTemplateCapabilities([]);
      load();
      toast.success('Role template created.');
    },
    onError: () => toast.error('Unable to create role template.'),
  });
  const assignMutation = useMutation({
    mutationFn: async ({ userId, roleTemplateId }: { userId: string; roleTemplateId: string }) => {
      const response = await fetch(`${base}/properties/${propertyId}/staff/${userId}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleTemplateId }),
      });
      if (!response.ok) throw new Error();
    },
    onSuccess: () => {
      load();
      toast.success('Staff role updated.');
    },
    onError: () => toast.error('Unable to update staff role.'),
  });
  const overrideMutation = useMutation({
    mutationFn: async ({ userId, key, value }: { userId: string; key: string; value: string }) => {
      const response = await fetch(
        `${base}/properties/${propertyId}/staff/${userId}/capabilities/${key}`,
        {
          method: value === 'default' ? 'DELETE' : 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: value === 'default' ? undefined : JSON.stringify({ granted: value === 'grant' }),
        },
      );
      if (!response.ok) throw new Error();
    },
    onSuccess: () => {
      load();
      toast.success('Capability override updated.');
    },
    onError: () => toast.error('Unable to update capability override.'),
  });
  const busy = inviteMutation.isPending
    ? 'invite'
    : createTemplateMutation.isPending
      ? 'template'
      : assignMutation.isPending
        ? `assign:${assignMutation.variables.userId}`
        : null;
  const columns = useMemo<ColumnDef<Staff>[]>(
    () => [
      {
        accessorKey: 'email',
        header: 'Staff member',
        cell: ({ row }) => <strong>{row.original.email}</strong>,
      },
      {
        id: 'role',
        header: 'Role template',
        cell: ({ row }) => (
          <select
            className="must-input"
            disabled={busy === `assign:${row.original.userId}`}
            value={row.original.roleTemplateId}
            onChange={(event) =>
              assignMutation.mutate({
                userId: row.original.userId,
                roleTemplateId: event.target.value,
              })
            }
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        ),
      },
      {
        id: 'capabilities',
        header: 'Capability overrides',
        cell: ({ row }) => {
          const template = templates.find(
            (candidate) => candidate.id === row.original.roleTemplateId,
          );
          return template?.capabilities.map((capability) => {
            const override = row.original.overrides.find(
              (candidate) => candidate.capabilityKey === capability.key,
            );
            const state = !override ? 'default' : override.granted ? 'grant' : 'revoke';
            return (
              <label key={capability.key}>
                {capability.key}
                <select
                  className="must-input"
                  aria-label={`${row.original.email} ${capability.key}`}
                  value={state}
                  onChange={(event) =>
                    overrideMutation.mutate({
                      userId: row.original.userId,
                      key: capability.key,
                      value: event.target.value,
                    })
                  }
                >
                  <option value="default">Template default</option>
                  <option value="grant">Explicitly granted</option>
                  <option value="revoke">Explicitly revoked</option>
                </select>
              </label>
            );
          });
        },
      },
    ],
    [assignMutation.mutate, busy, overrideMutation.mutate, templates],
  );
  const table = useReactTable({
    data: staff,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (member) => member.userId,
  });
  if (staffQuery.isError)
    return (
      <Stack gap="sm">
        <Text tone="secondary">{staffQuery.error.message}</Text>
        <button className="must-button must-button--secondary" onClick={load} type="button">
          Retry
        </button>
      </Stack>
    );
  if (staffQuery.isPending) return <DashboardLoadingSkeleton label="Loading staff…" />;
  return (
    <Stack gap="lg">
      <Heading>Staff</Heading>
      <Card>
        <input
          className="must-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Staff email"
        />
        <select
          className="must-input"
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
        <button
          className="must-button must-button--primary"
          disabled={capped || !email || busy !== null}
          onClick={() => inviteMutation.mutate()}
        >
          {busy === 'invite' ? <Loader2 aria-hidden="true" size={16} /> : 'Invite staff'}
        </button>
        {capped ? <Text>Upgrade to unlock more staff seats.</Text> : null}
      </Card>
      <Card>
        <Heading level={2}>Create role template</Heading>
        <input
          className="must-input"
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
        <button
          className="must-button must-button--secondary"
          disabled={!templateName || busy !== null}
          onClick={() => createTemplateMutation.mutate()}
        >
          {busy === 'template' ? <Loader2 aria-hidden="true" size={16} /> : 'Create template'}
        </button>
      </Card>
      <Card>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} colSpan={header.colSpan}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Stack>
  );
}
