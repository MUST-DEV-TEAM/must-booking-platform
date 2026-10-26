import type { AccommodationActivity } from './room-management-types';

export type AccommodationActivityGroup = {
  event: AccommodationActivity;
  count: number;
  lastGroupedAt: string;
};

/** Group adjacent identical accommodation changes made by one actor within ten minutes. */
export function groupActivityEvents(
  events: AccommodationActivity[],
  windowMs = 10 * 60 * 1000,
): AccommodationActivityGroup[] {
  const groups: AccommodationActivityGroup[] = [];
  for (const event of events) {
    const previous = groups.at(-1);
    const elapsed = previous
      ? Math.abs(new Date(previous.lastGroupedAt).getTime() - new Date(event.createdAt).getTime())
      : Infinity;
    if (
      previous &&
      elapsed <= windowMs &&
      previous.event.action === event.action &&
      previous.event.actorUserId === event.actorUserId &&
      previous.event.actorName === event.actorName &&
      previous.event.targetType === event.targetType &&
      (previous.event.targetName?.trim() || previous.event.targetId) ===
        (event.targetName?.trim() || event.targetId)
    ) {
      previous.count += 1;
      previous.lastGroupedAt = event.createdAt;
    } else {
      groups.push({ event, count: 1, lastGroupedAt: event.createdAt });
    }
  }
  return groups;
}

/** Turn accommodation audit actions into guest-facing names instead of database target types. */
export function activitySentence(event: AccommodationActivity): string {
  const action = typeof event.action === 'string' ? event.action : '';
  const targetName = event.targetName?.trim();
  const name =
    targetName ||
    ({
      room_type: 'Room type',
      room: 'Room',
      room_category: 'Category',
    }[event.targetType] ??
      'Accommodation item');
  switch (action) {
    case 'room_type.created':
    case 'room.created':
      return `Created ${name}`;
    case 'room_type.updated':
    case 'room.updated':
      return `Updated ${name}`;
    case 'room_type.deleted':
    case 'room.deleted':
      return `${name} deleted`;
    case 'room_type.status_changed':
      return `${name} ${
        typeof event.details?.to === 'string'
          ? event.details.to.toLowerCase()
          : 'publication status changed'
      }`;
    case 'room.active_changed':
      return `${name} set ${event.details?.to === true ? 'active' : 'inactive'}`;
    case 'room_category.created':
      return `Category ${name} created`;
    case 'room_category.updated':
      return `Category ${name} updated`;
    case 'room_category.deleted':
      return `Category ${name} deleted`;
    case 'room_category.reordered':
      return 'Categories reordered';
    case 'accommodation.imported':
      return `${targetName || 'Accommodation data'} imported`;
    case 'room_type.amenities_updated':
    case 'room.amenities_updated':
      return `Amenities changed on ${name}`;
    default:
      if (action.startsWith('room_type_image') || action.startsWith('room_type_images'))
        return targetName ? `Photos changed on ${name}` : 'Room type photos changed';
      if (action.startsWith('room_image') || action.startsWith('room_images'))
        return targetName ? `Photos changed on ${name}` : 'Room photos changed';
      return `${name} updated`;
  }
}

/** Format a concise relative time for the activity list. */
export function formatRelativeActivityTime(value: string, now = new Date()): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Unknown time';
  const differenceSeconds = Math.round((timestamp - now.getTime()) / 1000);
  const magnitude = Math.abs(differenceSeconds);
  const [amount, unit] =
    magnitude < 60
      ? [Math.max(1, magnitude), 'sec']
      : magnitude < 3600
        ? [Math.round(magnitude / 60), 'min']
        : magnitude < 86400
          ? [Math.round(magnitude / 3600), 'hr']
          : [Math.round(magnitude / 86400), 'day'];
  const phrase = `${amount} ${unit}${amount === 1 || unit !== 'day' ? '' : 's'}`;
  return differenceSeconds > 0 ? `in ${phrase}` : `${phrase} ago`;
}

/** Format the full local date used by the activity tooltip. */
export function formatActivityDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Unknown time'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(date);
}
