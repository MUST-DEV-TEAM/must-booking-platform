'use client';
import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
type Property = { id: string; name: string; address: string; timezone: string };
type Usage = { plan: { maxProperties: number }; usage: { properties: number } };
export function PropertyManagement({ tenantId }: { tenantId: string }) {
  const [properties, setProperties] = useState<Property[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const atCap = !!usage && usage.usage.properties >= usage.plan.maxProperties;
  const load = () =>
    Promise.all([
      fetch(`/api/tenants/${tenantId}/properties`, { credentials: 'include' }),
      fetch(`/api/tenants/${tenantId}/plan-usage`, { credentials: 'include' }),
    ]).then(async ([p, u]) => {
      if (p.ok) setProperties(await p.json());
      if (u.ok) setUsage(await u.json());
    });
  useEffect(() => {
    void load();
  }, [tenantId]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await fetch(`/api/tenants/${tenantId}/properties`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: f.get('name'),
        address: f.get('address'),
        timezone: f.get('timezone'),
      }),
    });
    if (r.status === 409) {
      toast.error('Upgrade to unlock more properties.');
      void load();
      return;
    }
    if (!r.ok) {
      toast.error('Unable to create property.');
      return;
    }
    e.currentTarget.reset();
    void load();
    toast.success('Property created.');
  }
  return (
    <section>
      <h2>Properties</h2>
      {atCap ? <aside role="status">Upgrade to unlock more properties.</aside> : null}
      <ul>
        {properties?.map((p) => (
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
