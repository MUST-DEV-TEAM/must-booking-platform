import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { parseServicesInput } from './venue-services-input';

const dinner = { name: 'Dinner', days: [1, 2, 3, 4, 5], opensAt: '19:00', closesAt: '23:00' };
const lunch = { name: 'Lunch', days: [6, 7], opensAt: '12:00', closesAt: '15:30', slotMinutes: 15 };

describe('parseServicesInput', () => {
  it('retains stable IDs and rejects a repeated ID even if its case differs', () => {
    const id = 'abcdefab-abcd-4abc-8abc-abcdefabcdef';
    expect(parseServicesInput({ services: [{ ...dinner, id: id.toUpperCase() }] })[0]?.id).toBe(id);
    expect(() =>
      parseServicesInput({
        services: [
          { ...dinner, id },
          { ...lunch, id: id.toUpperCase() },
        ],
      }),
    ).toThrow('Duplicate service ID');
  });
  it('returns each service with its slot length, defaulting to 30 minutes', () => {
    expect(parseServicesInput({ services: [dinner, lunch] })).toEqual([
      { ...dinner, slotMinutes: 30 },
      lunch,
    ]);
  });

  it('puts the days in order and drops repeats', () => {
    const [service] = parseServicesInput({ services: [{ ...dinner, days: [5, 1, 1, 3] }] });
    expect(service!.days).toEqual([1, 3, 5]);
  });

  it('accepts no services, which clears the opening hours', () => {
    expect(parseServicesInput({ services: [] })).toEqual([]);
  });

  it('lets two services share a day when their hours do not overlap', () => {
    expect(() =>
      parseServicesInput({
        services: [
          { name: 'Lunch', days: [1], opensAt: '12:00', closesAt: '15:00' },
          { name: 'Dinner', days: [1], opensAt: '15:00', closesAt: '23:00' },
        ],
      }),
    ).not.toThrow();
  });

  it.each([
    ['a missing list', {}],
    [
      'more than 6 services',
      { services: Array.from({ length: 7 }, (_, i) => ({ ...dinner, name: `S${i}` })) },
    ],
    ['a blank name', { services: [{ ...dinner, name: ' ' }] }],
    ['a name over 60 characters', { services: [{ ...dinner, name: 'x'.repeat(61) }] }],
    ['the same name twice', { services: [dinner, { ...lunch, name: 'dinner' }] }],
    ['no days', { services: [{ ...dinner, days: [] }] }],
    ['a day outside 1 to 7', { services: [{ ...dinner, days: [0] }] }],
    ['a day that is not a whole number', { services: [{ ...dinner, days: [1.5] }] }],
    ['a time that is not HH:MM', { services: [{ ...dinner, opensAt: '7pm' }] }],
    ['an impossible time', { services: [{ ...dinner, closesAt: '25:00' }] }],
    ['closing before opening', { services: [{ ...dinner, opensAt: '23:00', closesAt: '19:00' }] }],
    ['closing when it opens', { services: [{ ...dinner, opensAt: '19:00', closesAt: '19:00' }] }],
    ['a slot length that is not offered', { services: [{ ...dinner, slotMinutes: 25 }] }],
    [
      'two services that overlap on the same day',
      {
        services: [
          { name: 'A', days: [1], opensAt: '12:00', closesAt: '16:00' },
          { name: 'B', days: [1, 2], opensAt: '15:00', closesAt: '20:00' },
        ],
      },
    ],
  ])('rejects %s', (_label, body) => {
    expect(() => parseServicesInput(body)).toThrow(BadRequestException);
  });
});
