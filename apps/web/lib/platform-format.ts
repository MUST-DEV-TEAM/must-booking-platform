/** Display helpers for the platform console. */

const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateTime.format(date);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : dateOnly.format(date);
}

/** "3 days ago", "just now": coarse, for last-login style cells. */
export function formatAgo(value: string | null | undefined, now = Date.now()): string {
  if (!value) return 'Never';
  const ms = now - new Date(value).getTime();
  if (!Number.isFinite(ms)) return '—';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days} day${days === 1 ? '' : 's'} ago` : formatDate(value);
}

/** "platform.hotel.lifecycle_changed" -> "Hotel status changed". Falls back to the raw key. */
const ACTION_LABELS: Record<string, string> = {
  'platform.auth.login': 'Signed in',
  'platform.auth.logout': 'Signed out',
  'platform.auth.logout_everywhere': 'Signed out everywhere',
  'platform.access.denied': 'Access denied',
  'platform.hotel.created': 'Hotel created',
  'platform.hotel.owner_invited': 'Owner invited',
  'platform.hotel.lifecycle_changed': 'Hotel status changed',
  'platform.team.invited': 'Team member invited',
  'platform.team.created': 'Team member created',
  'platform.team.role_changed': 'Role changed',
  'platform.team.suspended': 'Team member suspended',
  'platform.team.reactivated': 'Team member reactivated',
  'platform.team.invitation_accepted': 'Invitation accepted',
  'platform.support.view_started': 'View-as started',
  'platform.support.act_requested': 'Act-as requested',
  'platform.support.act_approved': 'Act-as approved',
  'platform.support.act_denied': 'Act-as denied',
  'platform.support.revoked': 'Support session ended',
  'platform.support.entered': 'Entered hotel',
  'platform.support.request': 'Request in support session',
  'platform.audit.exported': 'Audit log exported',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/^platform\./, '').replace(/[._]/g, ' ');
}

export function hasCapability(capabilities: readonly string[], key: string): boolean {
  return capabilities.includes(key);
}
