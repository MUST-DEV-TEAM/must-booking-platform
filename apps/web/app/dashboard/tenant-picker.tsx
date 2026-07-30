'use client';
import { useEffect, useState } from 'react';
type Membership = { tenantId: string; organizationName: string; role: string };
export function TenantPicker() {
  const [items, setItems] = useState<Membership[] | null>(null);
  useEffect(() => {
    void fetch('/api/auth/memberships', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : { memberships: [] }))
      .then((x) => setItems(x.memberships))
      .catch(() => setItems([]));
  }, []);
  return (
    <main>
      <h1>Choose a workspace</h1>
      {items === null ? (
        <p>Loading workspaces…</p>
      ) : items.length === 0 ? (
        <p>No workspaces available.</p>
      ) : (
        <ul>
          {items.map((x) => (
            <li key={x.tenantId}>
              <a href={`/dashboard/${x.tenantId}`}>{x.organizationName}</a> ({x.role})
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
