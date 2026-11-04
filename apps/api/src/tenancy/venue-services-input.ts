import { BadRequestException } from '@nestjs/common';

/** One opening-hours service, for example "Dinner": open on some weekdays between two times. */
export type ServiceInput = {
  id?: string;
  name: string;
  /** Weekdays, 1 = Monday ... 7 = Sunday, in order and without repeats. */
  days: number[];
  opensAt: string;
  closesAt: string;
  slotMinutes: number;
};

const MAX_SERVICES = 6;
const SLOT_MINUTES = [10, 15, 20, 30, 45, 60];
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

function minutes(time: string): number {
  const [hours, mins] = time.split(':').map(Number);
  return hours! * 60 + mins!;
}

function parseService(raw: unknown): ServiceInput {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    throw new BadRequestException('Every service must be an object.');
  const body = raw as Record<string, unknown>;
  if (
    body.id !== undefined &&
    (typeof body.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id))
  )
    throw new BadRequestException('Invalid service ID.');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw new BadRequestException('Every service needs a name.');
  if (name.length > 60)
    throw new BadRequestException('A service name can be at most 60 characters.');

  const days = body.days;
  if (!Array.isArray(days) || days.length === 0)
    throw new BadRequestException(`${name}: choose at least one day.`);
  if (days.some((day) => typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 7))
    throw new BadRequestException(
      `${name}: days must be whole numbers from 1 (Monday) to 7 (Sunday).`,
    );

  for (const field of ['opensAt', 'closesAt'] as const) {
    const value = body[field];
    if (typeof value !== 'string' || !TIME.test(value))
      throw new BadRequestException(`${name}: times must look like 19:00.`);
  }
  const opensAt = body.opensAt as string;
  const closesAt = body.closesAt as string;
  if (minutes(closesAt) <= minutes(opensAt))
    throw new BadRequestException(`${name}: it must close after it opens, on the same day.`);

  const slotMinutes = body.slotMinutes === undefined ? 30 : body.slotMinutes;
  if (typeof slotMinutes !== 'number' || !SLOT_MINUTES.includes(slotMinutes))
    throw new BadRequestException(
      `${name}: bookable times can be every ${SLOT_MINUTES.join(', ')} minutes.`,
    );

  return {
    ...(body.id ? { id: (body.id as string).toLowerCase() } : {}),
    name,
    days: [...new Set(days as number[])].sort((a, b) => a - b),
    opensAt,
    closesAt,
    slotMinutes,
  };
}

/** The whole list of services for a restaurant; it replaces what was there before. */
export function parseServicesInput(raw: unknown): ServiceInput[] {
  const list = (typeof raw === 'object' && raw !== null ? (raw as { services?: unknown }) : {})
    .services;
  if (!Array.isArray(list)) throw new BadRequestException('Send the list of services.');
  if (list.length > MAX_SERVICES)
    throw new BadRequestException(`A restaurant can have at most ${MAX_SERVICES} services.`);
  const services = list.map(parseService);

  const names = new Set<string>();
  const ids = new Set<string>();
  for (const service of services) {
    if (service.id && ids.has(service.id)) throw new BadRequestException('Duplicate service ID.');
    if (service.id) ids.add(service.id);
    const key = service.name.toLowerCase();
    if (names.has(key))
      throw new BadRequestException(`There are two services called ${service.name}.`);
    names.add(key);
  }
  for (let i = 0; i < services.length; i += 1)
    for (let j = i + 1; j < services.length; j += 1) {
      const a = services[i]!;
      const b = services[j]!;
      const sharedDay = a.days.some((day) => b.days.includes(day));
      if (
        sharedDay &&
        minutes(a.opensAt) < minutes(b.closesAt) &&
        minutes(b.opensAt) < minutes(a.closesAt)
      )
        throw new BadRequestException(`${a.name} and ${b.name} overlap on the same day.`);
    }
  return services;
}
