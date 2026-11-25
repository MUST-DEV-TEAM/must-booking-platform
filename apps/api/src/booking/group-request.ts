import { BadRequestException } from '@nestjs/common';

import { validRuleDate } from './booking-rules';

/** What a guest sends to ask a hotel for a group quote, checked and cleaned. */
export type GroupRequestInput = {
  startsOn: string;
  endsOn: string;
  adults: number;
  children: number;
  rooms: number;
  name: string;
  email: string;
  phone: string | null;
  organisation: string | null;
  message: string | null;
  language: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^\+[1-9]\d{6,14}$/;
const LONGEST_STAY_NIGHTS = 60;

/** Control characters out (a line break stays when asked); anything else is kept. */
const withoutControls = (value: string, keepNewline: boolean): string =>
  Array.from(value)
    .map((character) => {
      const code = character.charCodeAt(0);
      if (code === 10 && keepNewline) return character;
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('');

const oneLine = (value: unknown, max: number): string =>
  typeof value === 'string'
    ? withoutControls(value, false).replace(/\s+/g, ' ').trim().slice(0, max)
    : '';

function wholeNumber(value: unknown, min: number, max: number, message: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    throw new BadRequestException(message);
  return value;
}

/** Checks a public group request. `today` is the hotel's own date (YYYY-MM-DD). */
export function parseGroupRequest(body: unknown, today: string): GroupRequestInput {
  const value = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const startsOn = typeof value.startsOn === 'string' ? value.startsOn : '';
  const endsOn = typeof value.endsOn === 'string' ? value.endsOn : '';
  if (!validRuleDate(startsOn) || !validRuleDate(endsOn))
    throw new BadRequestException('Choose your arrival and departure dates.');
  if (startsOn < today) throw new BadRequestException('The arrival date has already passed.');
  const nights = (Date.parse(endsOn) - Date.parse(startsOn)) / 86_400_000;
  if (nights < 1) throw new BadRequestException('The departure must be after the arrival.');
  if (nights > LONGEST_STAY_NIGHTS)
    throw new BadRequestException(
      `For stays longer than ${LONGEST_STAY_NIGHTS} nights, contact the hotel.`,
    );
  const adults = wholeNumber(value.adults, 1, 500, 'Enter how many adults (1 to 500).');
  const children =
    value.children === undefined
      ? 0
      : wholeNumber(value.children, 0, 500, 'Enter how many children (0 to 500).');
  const rooms = wholeNumber(value.rooms, 1, 200, 'Enter how many rooms (1 to 200).');
  const name = oneLine(value.name, 160);
  if (name.length < 2) throw new BadRequestException('Enter your name.');
  const email = oneLine(value.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new BadRequestException('Enter a valid email address.');
  const phone = oneLine(value.phone, 32).replace(/\s+/g, '');
  if (phone && !PHONE_RE.test(phone))
    throw new BadRequestException(
      'Enter the phone number with its country code, for example +355691234567.',
    );
  const message =
    typeof value.message === 'string'
      ? withoutControls(value.message.split('\r\n').join('\n'), true).trim().slice(0, 2000)
      : '';
  if ((message.match(/https?:\/\//gi) ?? []).length > 2)
    throw new BadRequestException('Remove the links from your message.');
  const language = oneLine(value.language, 5).toLowerCase();
  return {
    startsOn,
    endsOn,
    adults,
    children,
    rooms,
    name,
    email,
    phone: phone || null,
    organisation: oneLine(value.organisation, 160) || null,
    message: message || null,
    language: /^[a-z]{2}(-[a-z]{2})?$/.test(language) ? language : null,
  };
}
