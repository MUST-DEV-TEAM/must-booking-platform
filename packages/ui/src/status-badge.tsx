import type { CSSProperties } from 'react';
import {
  statusTokenPairs,
  type StatusBadgeDomain,
  type StatusBadgeState,
  type StatusTokenPair,
} from './tokens';

type StatusBadgeStyle = CSSProperties & {
  '--must-status-badge-background': string;
  '--must-status-badge-foreground': string;
};

type StatusBadgeDomainState = {
  [Domain in StatusBadgeDomain]: {
    domain: Domain;
    state: keyof (typeof statusTokenPairs)[Domain];
  };
}[StatusBadgeDomain];

export type StatusBadgeProps = StatusBadgeDomainState & {
  className?: string;
  label?: string;
};

function formatStateLabel(state: string) {
  return state
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getTokenPair(domain: StatusBadgeDomain, state: StatusBadgeState): StatusTokenPair {
  return (statusTokenPairs[domain] as Record<string, StatusTokenPair>)[state];
}

/** A text-bearing semantic status indicator. Color reinforces the state; it never carries it alone. */
export function StatusBadge({ className, domain, label, state }: StatusBadgeProps) {
  const pair = getTokenPair(domain, state);
  const style: StatusBadgeStyle = {
    '--must-status-badge-background': `var(${pair.background})`,
    '--must-status-badge-foreground': `var(${pair.foreground})`,
  };

  return (
    <span
      className={['must-status-badge', className].filter(Boolean).join(' ')}
      data-domain={domain}
      data-state={state}
      style={style}
    >
      {label?.trim() || formatStateLabel(state)}
    </span>
  );
}
