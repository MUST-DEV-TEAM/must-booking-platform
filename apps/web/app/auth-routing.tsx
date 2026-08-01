'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export type SessionUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  isPlatformAdmin: boolean;
};

export type LoginReason = 'session-expired' | 'logout-confirmation' | 'logged-out';

function isSafeReturnPath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//');
}

export function loginPath(reason?: LoginReason, returnTo?: string): string {
  const params = new URLSearchParams();
  if (reason) params.set('reason', reason);
  if (returnTo && isSafeReturnPath(returnTo)) params.set('returnTo', returnTo);
  const query = params.toString();
  return query ? `/login?${query}` : '/login';
}

export async function fetchSessionUser(): Promise<SessionUser | null> {
  const response = await fetch('/api/auth/session', { credentials: 'include' });
  if (!response.ok) return null;
  const body = (await response.json()) as { user?: Partial<SessionUser> };
  if (!body.user?.id || !body.user.email) return null;
  return {
    id: body.user.id,
    email: body.user.email,
    emailVerified: body.user.emailVerified === true,
    isPlatformAdmin: body.user.isPlatformAdmin === true,
  };
}

export function authDestination(user: SessionUser, returnTo?: string): string {
  if (returnTo && isSafeReturnPath(returnTo)) {
    if (user.isPlatformAdmin && returnTo.startsWith('/platform')) return returnTo;
    if (!user.isPlatformAdmin && returnTo.startsWith('/dashboard')) return returnTo;
  }
  return user.isPlatformAdmin ? '/platform' : '/dashboard';
}

export function HomeAuthRedirect({ children }: { children: ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    void fetchSessionUser()
      .then((user) => {
        if (!cancelled && user) router.replace(authDestination(user));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [router]);

  return children;
}

export function AuthRouteGuard({
  audience,
  children,
}: {
  audience: 'platform' | 'tenant';
  children: ReactNode;
}) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchSessionUser()
      .then((user) => {
        if (cancelled) return;
        if (!user) {
          const returnTo = `${window.location.pathname}${window.location.search}`;
          router.replace(loginPath('session-expired', returnTo));
          return;
        }
        const destination = authDestination(user);
        if (
          (audience === 'platform' && destination !== '/platform') ||
          (audience === 'tenant' && destination !== '/dashboard')
        ) {
          router.replace(destination);
          return;
        }
        setAuthorized(true);
      })
      .catch(() => {
        if (!cancelled) {
          const returnTo = `${window.location.pathname}${window.location.search}`;
          router.replace(loginPath('session-expired', returnTo));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [audience, router]);

  if (!authorized) {
    return (
      <main>
        <p>Checking your account access…</p>
      </main>
    );
  }

  return children;
}
