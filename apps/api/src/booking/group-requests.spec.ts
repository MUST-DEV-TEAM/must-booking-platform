import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import {
  groupRequestGuestEmail,
  groupRequestHotelEmail,
} from '../mail/group-request-email-content';
import { parseGroupRequest } from './group-request';
import { GroupRequestsService } from './group-requests.service';

const today = '2026-11-22';
const valid = {
  startsOn: '2027-06-10',
  endsOn: '2027-06-14',
  adults: 22,
  children: 4,
  rooms: 11,
  name: 'Elira Test',
  email: 'Group-Test@Example.test',
  phone: '+355 69 123 4567',
  organisation: 'Wedding party TEST',
  message: 'Wedding weekend, need 11 rooms.',
  language: 'EN',
};

describe('parseGroupRequest', () => {
  it('cleans a valid request', () => {
    expect(parseGroupRequest(valid, today)).toEqual({
      startsOn: '2027-06-10',
      endsOn: '2027-06-14',
      adults: 22,
      children: 4,
      rooms: 11,
      name: 'Elira Test',
      email: 'group-test@example.test',
      phone: '+355691234567',
      organisation: 'Wedding party TEST',
      message: 'Wedding weekend, need 11 rooms.',
      language: 'en',
    });
  });

  it('accepts a request without the optional fields', () => {
    const request = parseGroupRequest(
      {
        startsOn: '2027-06-10',
        endsOn: '2027-06-11',
        adults: 12,
        rooms: 6,
        name: 'Ada',
        email: 'a@b.co',
      },
      today,
    );
    expect(request).toMatchObject({
      children: 0,
      phone: null,
      organisation: null,
      message: null,
      language: null,
    });
  });

  it.each([
    [{ ...valid, startsOn: '2026-11-21' }, 'already passed'],
    [{ ...valid, endsOn: '2027-06-10' }, 'after the arrival'],
    [{ ...valid, endsOn: '2027-12-31' }, 'longer than 60 nights'],
    [{ ...valid, startsOn: 'tomorrow' }, 'dates'],
    [{ ...valid, adults: 0 }, 'adults'],
    [{ ...valid, adults: 2.5 }, 'adults'],
    [{ ...valid, children: -1 }, 'children'],
    [{ ...valid, rooms: 201 }, 'rooms'],
    [{ ...valid, name: 'A' }, 'name'],
    [{ ...valid, email: 'nope' }, 'email'],
    [{ ...valid, phone: '691234567' }, 'country code'],
    [{ ...valid, message: 'http://a.test http://b.test http://c.test' }, 'links'],
  ])('refuses a bad request: %#', (body, text) => {
    expect(() => parseGroupRequest(body, today)).toThrow(text);
  });

  it('refuses a request that is not an object', () => {
    expect(() => parseGroupRequest(null, today)).toThrow('dates');
    expect(() => parseGroupRequest('x', today)).toThrow('dates');
  });

  it('strips control characters and keeps line breaks in the message only', () => {
    const request = parseGroupRequest(
      { ...valid, name: 'Ada\u0000 \nLovelace', message: 'one\r\ntwo\u0007' },
      today,
    );
    expect(request.name).toBe('Ada Lovelace');
    expect(request.message).toBe('one\ntwo');
  });
});

function service(property: Record<string, unknown> | null) {
  const queryRaw = vi
    .fn()
    .mockResolvedValueOnce(property ? [property] : [])
    .mockResolvedValue([{ id: 'request-1' }]);
  const database = {
    withTenantTransaction: async (_c: unknown, callback: (tx: unknown) => Promise<unknown>) =>
      callback({ $queryRaw: queryRaw }),
  };
  const notifications = { recordInTransaction: vi.fn().mockResolvedValue(undefined) };
  const delivery = { dispatch: vi.fn().mockResolvedValue(undefined) };
  const requests = new GroupRequestsService(
    database as never,
    notifications as never,
    delivery as never,
  );
  return { requests, queryRaw, notifications, delivery };
}
const hotel = {
  name: 'Beach Hotel',
  timezone: 'Europe/Tirane',
  groupRequestForm: true,
  groupRequestEmail: 'groups@hotel.test',
  reservationsEmail: 'reservations@hotel.test',
  supportEmail: 'help@hotel.test',
};
const context = { tenantId: 't', propertyId: 'p' };

describe('GroupRequestsService', () => {
  it('stores the request, notifies the hotel and emails the hotel and the guest', async () => {
    const { requests, notifications, delivery } = service(hotel);
    await expect(requests.submit(context, valid)).resolves.toEqual({ id: 'request-1' });
    expect(notifications.recordInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'GROUP_REQUEST_RECEIVED',
        payload: expect.objectContaining({ requestId: 'request-1', guests: 26, rooms: 11 }),
      }),
    );
    const sent = delivery.dispatch.mock.calls.map(([, command]) => command);
    expect(sent.map((command) => command.to)).toEqual([
      'groups@hotel.test',
      'group-test@example.test',
    ]);
    expect(sent.map((command) => command.idempotencyKey)).toEqual([
      'group-request/request-1/hotel',
      'group-request/request-1/guest',
    ]);
    expect(sent[0].replyTo).toBe('group-test@example.test');
  });

  it.each([
    [{ groupRequestEmail: null }, 'reservations@hotel.test'],
    [{ groupRequestEmail: null, reservationsEmail: null }, 'help@hotel.test'],
  ])('falls back to the next hotel address: %#', async (patch, expected) => {
    const { requests, delivery } = service({ ...hotel, ...patch });
    await requests.submit(context, valid);
    expect(delivery.dispatch.mock.calls[0]![1].to).toBe(expected);
  });

  it('still stores the request and thanks the guest when the hotel has no address', async () => {
    const { requests, delivery } = service({
      ...hotel,
      groupRequestEmail: null,
      reservationsEmail: null,
      supportEmail: null,
    });
    await expect(requests.submit(context, valid)).resolves.toEqual({ id: 'request-1' });
    expect(delivery.dispatch).toHaveBeenCalledTimes(1);
    expect(delivery.dispatch.mock.calls[0]![1].to).toBe('group-test@example.test');
  });

  it('takes no request when the hotel did not switch the form on, and stores nothing', async () => {
    const { requests, notifications, delivery, queryRaw } = service({
      ...hotel,
      groupRequestForm: false,
    });
    await expect(requests.submit(context, valid)).rejects.toBeInstanceOf(NotFoundException);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(notifications.recordInTransaction).not.toHaveBeenCalled();
    expect(delivery.dispatch).not.toHaveBeenCalled();
  });

  it('refuses an unknown hotel and a bad request before storing anything', async () => {
    await expect(service(null).requests.submit(context, valid)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const { requests, queryRaw } = service(hotel);
    await expect(requests.submit(context, { ...valid, email: 'nope' })).rejects.toThrow('email');
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('does not fail the request when sending an email fails', async () => {
    const { requests, delivery } = service(hotel);
    delivery.dispatch.mockRejectedValue(new Error('mail down'));
    await expect(requests.submit(context, valid)).resolves.toEqual({ id: 'request-1' });
  });
});

describe('group request emails', () => {
  const brand = { name: 'Beach Hotel', supportEmail: 'help@hotel.test' } as never;
  const request = parseGroupRequest({ ...valid, message: '<script>alert(1)</script> Hi' }, today);

  it('tells the hotel who asked, with the details, and lets it reply to the guest', () => {
    const email = groupRequestHotelEmail(brand, request, 'groups@hotel.test', 'https://app.test/d');
    expect(email.subject).toBe('Group request: Elira Test, 26 guests, 2027-06-10');
    expect(email.replyTo).toBe('group-test@example.test');
    expect(email.text).toContain('Stay: 2027-06-10 to 2027-06-14 (4 nights)');
    expect(email.text).toContain('Guests: 22 adults, 4 children');
    expect(email.text).toContain('Dashboard: https://app.test/d');
    expect(email.html).not.toContain('<script>');
  });

  it('thanks the guest and says it is not a booking yet', () => {
    const email = groupRequestGuestEmail(brand, request);
    expect(email.to).toBe('group-test@example.test');
    expect(email.text).toContain('This is not a booking yet.');
    expect(email.text).not.toContain('group-test@example.test');
  });
});
