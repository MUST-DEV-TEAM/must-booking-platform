'use client';

import { useEffect, useState } from 'react';

type SessionUser = { id: string; email: string; emailVerified: boolean };

export function DashboardShell({ initialUser }: { initialUser?: SessionUser | null }) {
  const [user, setUser] = useState<SessionUser | null | undefined>(initialUser);

  useEffect(() => {
    if (initialUser !== undefined) return;
    void fetch('/api/auth/session', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return null;
        const body = (await response.json()) as { user: SessionUser };
        return body.user;
      })
      .then(setUser)
      .catch(() => setUser(null));
  }, [initialUser]);

  return (
    <main>
      <h1>Your MUST Booking dashboard</h1>
      {user === undefined ? <p>Checking your account status…</p> : null}
      {user && !user.emailVerified ? (
        <aside role="status">
          Verify your email to invite staff and manage sensitive workspace settings. Check your
          inbox for the verification link.
        </aside>
      ) : null}
      <p>Your Free-plan workspace is ready. Property, room, and rate setup arrives next.</p>
    </main>
  );
}
