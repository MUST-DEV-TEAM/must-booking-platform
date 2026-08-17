'use client';
import { Text } from '@must/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent } from 'react';
import { toast } from 'sonner';
type Property = { id: string; name: string; address: string; timezone: string };
type Usage = { plan: { maxProperties: number }; usage: { properties: number } };

type PropertiesData = { properties: Property[]; usage: Usage };
type CreatePropertyInput = {
  name: FormDataEntryValue | null;
  address: FormDataEntryValue | null;
  timezone: FormDataEntryValue | null;
  form: HTMLFormElement;
};

export function PropertyManagement({ tenantId }: { tenantId: string }) {
  const queryClient = useQueryClient();
  const propertiesQueryKey = ['dashboard', 'properties', tenantId] as const;
  const propertiesQuery = useQuery({
    queryKey: propertiesQueryKey,
    queryFn: async (): Promise<PropertiesData> => {
      const [propertiesResponse, usageResponse] = await Promise.all([
        fetch(`/api/tenants/${tenantId}/properties`, { credentials: 'include' }),
        fetch(`/api/tenants/${tenantId}/plan-usage`, { credentials: 'include' }),
      ]);
      if (!propertiesResponse.ok || !usageResponse.ok)
        throw new Error('Unable to load properties.');
      return {
        properties: (await propertiesResponse.json()) as Property[],
        usage: (await usageResponse.json()) as Usage,
      };
    },
  });
  const createPropertyMutation = useMutation({
    mutationFn: async ({ name, address, timezone }: CreatePropertyInput) => {
      const response = await fetch(`/api/tenants/${tenantId}/properties`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, address, timezone }),
      });
      if (response.status === 409) return 'at-cap' as const;
      if (!response.ok) throw new Error('Unable to create property.');
      return 'created' as const;
    },
    onSuccess: (result, { form }) => {
      void queryClient.invalidateQueries({ queryKey: propertiesQueryKey });
      if (result === 'at-cap') {
        toast.error('Upgrade to unlock more properties.');
        return;
      }
      form.reset();
      toast.success('Property created.');
    },
    onError: () => toast.error('Unable to create property.'),
  });
  const deletePropertyMutation = useMutation({
    mutationFn: async ({
      property,
      confirmationName,
    }: {
      property: Property;
      confirmationName: string;
    }) => {
      const response = await fetch(`/api/tenants/${tenantId}/properties/${property.id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmationName }),
      });
      if (response.ok) return;
      const result = (await response.json().catch(() => null)) as {
        message?: string;
        blockers?: Array<{ resource: string; count: number }>;
      } | null;
      const blockers = result?.blockers
        ?.map((blocker) => `${blocker.count} ${blocker.resource}`)
        .join(', ');
      throw new Error(
        blockers
          ? `Cannot delete this property: ${blockers}.`
          : (result?.message ?? 'Unable to delete property.'),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: propertiesQueryKey });
      toast.success('Property deleted.');
    },
    onError: (error) => toast.error(error.message),
  });
  const properties = propertiesQuery.data?.properties ?? [];
  const usage = propertiesQuery.data?.usage;
  const atCap = !!usage && usage.usage.properties >= usage.plan.maxProperties;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    createPropertyMutation.mutate({
      name: f.get('name'),
      address: f.get('address'),
      timezone: f.get('timezone'),
      form: e.currentTarget,
    });
  }

  function confirmDelete(property: Property) {
    const confirmationName = window.prompt(
      `Type "${property.name}" to permanently delete this property.`,
    );
    if (confirmationName === null) return;
    deletePropertyMutation.mutate({ property, confirmationName });
  }

  if (propertiesQuery.isPending)
    return (
      <section aria-label="Loading properties">
        <Text>Loading properties…</Text>
      </section>
    );
  if (propertiesQuery.isError)
    return (
      <section aria-label="Properties unavailable">
        <Text>{propertiesQuery.error.message}</Text>
        <button
          className="must-button"
          type="button"
          onClick={() => void propertiesQuery.refetch()}
        >
          Retry
        </button>
      </section>
    );

  return (
    <section>
      {atCap ? <Text tone="secondary">Upgrade to unlock more properties.</Text> : null}
      <ul>
        {properties.map((p) => (
          <li key={p.id}>
            {p.name} — {p.address} ({p.timezone})
            <button
              className="must-button"
              type="button"
              disabled={deletePropertyMutation.isPending}
              onClick={() => confirmDelete(p)}
            >
              Delete property
            </button>
          </li>
        ))}
      </ul>
      <form className="must-stack must-stack--md" onSubmit={submit}>
        <label className="must-field">
          <span className="must-field__label">Name</span>
          <input className="must-input" name="name" required disabled={atCap} />
        </label>
        <label className="must-field">
          <span className="must-field__label">Address</span>
          <input className="must-input" name="address" required disabled={atCap} />
        </label>
        <label className="must-field">
          <span className="must-field__label">Timezone</span>
          <input className="must-input" name="timezone" required disabled={atCap} />
        </label>
        <button className="must-button must-button--primary" disabled={atCap}>
          Add property
        </button>
      </form>
    </section>
  );
}
