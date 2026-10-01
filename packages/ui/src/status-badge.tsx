import {
  Ban,
  CalendarClock,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  LogIn,
  LogOut,
  Sparkles,
  Undo2,
  User,
  UserX,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
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
  /** The state icon is on by default so a state never relies on color alone; pass `false` to hide it. */
  icon?: boolean;
};

/** One glyph per state. Decorative: the label text always names the state. */
const stateIcons: {
  [Domain in StatusBadgeDomain]: Record<keyof (typeof statusTokenPairs)[Domain], LucideIcon>;
} = {
  booking: {
    pending: Clock,
    confirmed: CircleCheck,
    cancelled: CircleX,
    'checked-in': LogIn,
    'checked-out': LogOut,
    'no-show': UserX,
  },
  payment: {
    pending: Clock,
    paid: CircleCheck,
    failed: CircleX,
    refunded: Undo2,
    unpaid: CircleDashed,
  },
  room: {
    available: CircleCheck,
    occupied: User,
    cleaning: Sparkles,
    maintenance: Wrench,
    reserved: CalendarClock,
    'out-of-service': Ban,
  },
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
export function StatusBadge({ className, domain, label, state, icon = true }: StatusBadgeProps) {
  const pair = getTokenPair(domain, state);
  const Icon = (stateIcons[domain] as Record<string, LucideIcon>)[state];
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
      {icon && Icon ? <Icon aria-hidden="true" size={12} strokeWidth={2.25} /> : null}
      {label?.trim() || formatStateLabel(state)}
    </span>
  );
}
