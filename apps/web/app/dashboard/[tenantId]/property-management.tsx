'use client';
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

  if (propertiesQuery.isPending)
    return (
      <section aria-label="Loading properties">
        <p>Loading properties…</p>
      </section>
    );
  if (propertiesQuery.isError)
    return (
      <section aria-label="Properties unavailable">
        <p>{propertiesQuery.error.message}</p>
        <button type="button" onClick={() => void propertiesQuery.refetch()}>
          Retry
        </button>
      </section>
    );

  return (
    <section>
      <h2>Properties</h2>
      {atCap ? <aside role="status">Upgrade to unlock more properties.</aside> : null}
      <ul>
        {properties.map((p) => (
          <li key={p.id}>
            {p.name} — {p.address} ({p.timezone})
          </li>
        ))}
      </ul>
      <form onSubmit={submit}>
        <label>
          Name
          <input name="name" required disabled={atCap} />
        </label>
        <label>
          Address
          <input name="address" required disabled={atCap} />
        </label>
        <label>
          Timezone
          <input name="timezone" required disabled={atCap} />
        </label>
        <button disabled={atCap}>Add property</button>
      </form>
    </section>
  );
}
