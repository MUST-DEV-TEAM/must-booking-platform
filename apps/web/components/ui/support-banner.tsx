'use client';

import { Eye, ShieldAlert } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from './button';

/** "12 min left", "45 s left" or "expired", from an ISO time. Pure so it can be tested. */
export function timeLeft(expiresAt: string, now: number): string {
  const ms = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'expired';
  const minutes = Math.floor(ms / 60_000);
  if (minutes >= 1) return `${minutes} min left`;
  return `${Math.max(1, Math.floor(ms / 1000))} s left`;
}

/**
 * Persistent bar shown across the hotel dashboard while a MUST platform account is inside it.
 * View-as is blue and read-only; act-as is amber and says changes are made on the hotel's behalf.
 */
export function SupportBanner({
  kind,
  who,
  expiresAt,
  onEnd,
  ending = false,
  direct = false,
}: {
  kind: 'VIEW' | 'ACT';
  /** The platform account's name or email. */
  who: string;
  expiresAt: string;
  onEnd: () => void;
  ending?: boolean;
  /** A direct (owner-level) session: no time limit to show. */
  direct?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const acting = kind === 'ACT';
  const Icon = acting ? ShieldAlert : Eye;
  return (
    <div
      role="status"
      data-support-mode={kind}
      className={
        acting
          ? 'sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b border-warning/40 bg-warning-surface px-4 py-2 text-sm text-warning'
          : 'sticky top-0 z-50 flex flex-wrap items-center justify-between gap-3 border-b border-info/40 bg-info-surface px-4 py-2 text-sm text-info'
      }
    >
      <p className="m-0 flex items-center gap-2 font-semibold">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {direct
          ? `Direct access: ${who} is inside this hotel as its owner. Every action is recorded in the platform log.`
          : acting
            ? `Support access: ${who} can make limited changes on this hotel’s behalf. Every action is recorded.`
            : `Support access: ${who} is viewing this hotel. Read-only; nothing can be changed.`}
        {direct ? null : (
          <span className="font-normal opacity-80">· {timeLeft(expiresAt, now)}</span>
        )}
      </p>
      <Button variant="outline" size="sm" onClick={onEnd} loading={ending}>
        End session
      </Button>
    </div>
  );
}
