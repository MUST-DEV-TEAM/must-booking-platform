'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, History, LayoutDashboard, LifeBuoy, Loader2, Users } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, type ReactNode, useContext, useEffect, useMemo } from 'react';

import { PlatformShell, type PlatformNavItem } from '../../../components/ui/platform-shell';
import {
  ConsoleApiError,
  consoleGet,
  consolePost,
  type PlatformMe,
} from '../../../lib/platform-api';

type ConsoleSession = { me: PlatformMe; can: (capability: string) => boolean };
const SessionContext = createContext<ConsoleSession | null>(null);

/** The signed-in platform account and what its role allows. Only usable inside the console frame. */
export function useConsoleSession(): ConsoleSession {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useConsoleSession must be used inside the console frame.');
  return value;
}

/** Provides a signed-in account to the console pages. Also used by tests. */
export function ConsoleSessionProvider({ me, children }: { me: PlatformMe; children: ReactNode }) {
  const value = useMemo<ConsoleSession>(
    () => ({ me, can: (capability) => me.capabilities.includes(capability) }),
    [me],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export const platformMeKey = ['platform-console', 'me'] as const;

/** Signs the person in (or sends them to the sign-in page) and wraps the page in the console shell. */
export function ConsoleFrame({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '/platform';
  const queryClient = useQueryClient();
  const meQuery = useQuery({
    queryKey: platformMeKey,
    queryFn: () => consoleGet<{ me: PlatformMe }>('/auth/me').then((body) => body.me),
  });

  const unauthenticated = meQuery.error instanceof ConsoleApiError && meQuery.error.status === 401;
  useEffect(() => {
    if (!unauthenticated) return;
    const returnTo = `${window.location.pathname}${window.location.search}`;
    router.replace(`/platform/login?returnTo=${encodeURIComponent(returnTo)}`);
  }, [unauthenticated, router]);

  const session = useMemo<ConsoleSession | null>(
    () =>
      meQuery.data
        ? { me: meQuery.data, can: (capability) => meQuery.data.capabilities.includes(capability) }
        : null,
    [meQuery.data],
  );

  if (!session) {
    if (meQuery.isError && !unauthenticated) {
      return (
        <main className="grid min-h-screen place-items-center p-6">
          <div role="alert" className="max-w-md space-y-2 text-center">
            <p className="m-0 font-bold">The console could not be reached</p>
            <p className="m-0 text-sm text-muted-foreground">
              Nothing was changed. Reload the page; if it keeps failing, tell the engineering team.
              {meQuery.error instanceof ConsoleApiError && meQuery.error.reference
                ? ` Reference: ${meQuery.error.reference}`
                : ''}
            </p>
          </div>
        </main>
      );
    }
    return (
      <main role="status" aria-live="polite" className="grid min-h-screen place-items-center">
        <Loader2 aria-hidden="true" className="size-8 animate-spin opacity-60" />
        <span className="sr-only">Loading…</span>
      </main>
    );
  }

  const { me, can } = session;
  const items: Array<PlatformNavItem & { visible: boolean }> = [
    { href: '/platform', label: 'Overview', icon: LayoutDashboard, visible: true },
    {
      href: '/platform/hotels',
      label: 'Hotels',
      icon: Building2,
      visible: can('platform.hotels.view'),
    },
    {
      href: '/platform/support',
      label: 'Support access',
      icon: LifeBuoy,
      visible:
        can('platform.support.view_as') ||
        can('platform.support.act_as') ||
        can('platform.support.approve'),
    },
    { href: '/platform/team', label: 'Team', icon: Users, visible: can('platform.team.view') },
    {
      href: '/platform/audit',
      label: 'Audit log',
      icon: History,
      visible: can('platform.audit.view'),
    },
  ];
  const nav = items
    .filter((item) => item.visible)
    .map(({ visible: _visible, ...item }) => ({
      ...item,
      current:
        item.href === '/platform' ? pathname === '/platform' : pathname.startsWith(item.href),
    }));

  return (
    <ConsoleSessionProvider me={me}>
      <PlatformShell
        nav={nav}
        user={{ name: me.name, email: me.email, roleName: me.roleName }}
        onSignOut={() => {
          void consolePost('/auth/logout', {}).finally(() => {
            queryClient.clear();
            router.replace('/platform/login');
          });
        }}
      >
        {children}
      </PlatformShell>
    </ConsoleSessionProvider>
  );
}
