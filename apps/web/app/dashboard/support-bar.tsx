'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { SupportBanner } from '../../components/ui/support-banner';

type Session = {
  id: string;
  tenantId: string;
  hotelName?: string;
  kind: 'VIEW' | 'ACT';
  status: 'PENDING_APPROVAL' | 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'DENIED';
  reason: string;
  requestedBy: { email: string; name: string | null };
  expiresAt: string;
};

function tenantFromPath(pathname: string | null): string | null {
  const match = pathname?.match(/^\/dashboard\/([0-9a-f-]{36})(?:\/|$)/i);
  return match ? match[1]! : null;
}

async function json<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(`/api${path}`, { credentials: 'include', ...init });
    if (!response.ok) return null;
    return response.status === 204 ? (null as T) : ((await response.json()) as T);
  } catch {
    return null;
  }
}

/**
 * Two things for the hotel dashboard. A bar across the top while a MUST platform account is inside
 * the hotel (who, view-only or acting, how long is left, end session), and, for the hotel owner, a
 * notice of support sessions with Approve / Deny for act-as requests.
 */
export function SupportBar() {
  const pathname = usePathname();
  const tenantId = tenantFromPath(pathname);
  const [current, setCurrent] = useState<{ session: Session } | null>(null);
  const [currentLoaded, setCurrentLoaded] = useState(false);
  const [ownerSessions, setOwnerSessions] = useState<Session[]>([]);
  const [ownerChecked, setOwnerChecked] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const result = await json<{ active: boolean; session?: Session }>('/support/current');
      if (cancelled) return;
      setCurrent(result?.active && result.session ? { session: result.session } : null);
      setCurrentLoaded(true);
    };
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [tenantId]);

  const refreshOwner = useCallback(async () => {
    // Wait until we know this is not a support session; a support viewer is not the owner.
    if (!tenantId || !currentLoaded || current) return;
    const result = await json<{ sessions: Session[] }>(`/tenants/${tenantId}/support-sessions`);
    // A 403 (not the owner) leaves result null: nothing to show, and no point asking again.
    setOwnerChecked(result !== null);
    setOwnerSessions(
      (result?.sessions ?? []).filter(
        (session) => session.status === 'PENDING_APPROVAL' || session.status === 'ACTIVE',
      ),
    );
  }, [tenantId, current, currentLoaded]);

  useEffect(() => {
    void refreshOwner();
  }, [refreshOwner]);
  useEffect(() => {
    if (!ownerChecked) return;
    const timer = setInterval(() => void refreshOwner(), 60_000);
    return () => clearInterval(timer);
  }, [ownerChecked, refreshOwner]);

  const decide = async (session: Session, action: 'approve' | 'deny' | 'revoke') => {
    setBusy(session.id);
    await json(`/tenants/${session.tenantId}/support-sessions/${session.id}/${action}`, {
      method: 'POST',
    });
    await refreshOwner();
    setBusy(null);
  };

  return (
    <>
      {current ? (
        <SupportBanner
          kind={current.session.kind}
          who={current.session.requestedBy.name ?? current.session.requestedBy.email}
          expiresAt={current.session.expiresAt}
          ending={busy === 'end'}
          onEnd={() => {
            setBusy('end');
            void json('/support/end', { method: 'POST' }).then(() => {
              window.location.assign(`/platform/hotels/${current.session.tenantId}`);
            });
          }}
        />
      ) : null}
      {ownerSessions.length > 0 ? (
        <div className="space-y-2 px-4 pt-3">
          {ownerSessions.map((session) => {
            const who = session.requestedBy.name ?? session.requestedBy.email;
            const acting = session.kind === 'ACT';
            return (
              <Alert
                key={session.id}
                variant={session.status === 'PENDING_APPROVAL' ? 'warning' : 'info'}
              >
                <AlertTitle>
                  {session.status === 'PENDING_APPROVAL'
                    ? `MUST support is asking to work in your hotel (${who})`
                    : `MUST support is ${acting ? 'working in' : 'viewing'} your hotel (${who})`}
                </AlertTitle>
                <AlertDescription>
                  <span>
                    Reason: “{session.reason}”.{' '}
                    {session.status === 'PENDING_APPROVAL'
                      ? 'They can make limited changes for up to an hour once you approve. Never billing, staff, credentials, refunds or deletions.'
                      : `Until ${new Date(session.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Everything they do is recorded in your audit log.`}
                  </span>
                  <span className="flex gap-2">
                    {session.status === 'PENDING_APPROVAL' ? (
                      <>
                        <Button
                          size="sm"
                          loading={busy === session.id}
                          onClick={() => void decide(session, 'approve')}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void decide(session, 'deny')}
                        >
                          Deny
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={busy === session.id}
                        onClick={() => void decide(session, 'revoke')}
                      >
                        End their access
                      </Button>
                    )}
                  </span>
                </AlertDescription>
              </Alert>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
