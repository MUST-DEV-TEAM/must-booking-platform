import { describe, it, expect } from 'vitest';
import { isReservedEmail, propertyEmailHourlyCap } from './email-safety';
describe('Email delivery boundaries', () => {
  it.each([
    'a@example.test',
    'a@EXAMPLE.COM',
    'a@sub.example.org',
    'a@invalid',
    'a@local.localhost',
    'a@hotel.example',
  ])('blocks reserved recipient %s', (address) => expect(isReservedEmail(address)).toBe(true));
  it.each(['a@myexample.com', 'a@example.com.al', 'a@hotel.al'])(
    'keeps a normal recipient %s',
    (address) => expect(isReservedEmail(address)).toBe(false),
  );
  it.each([undefined, '', '0', '-1', 'Infinity', '10001', 'abc'])(
    'keeps a finite cap for %s',
    (value) => expect(propertyEmailHourlyCap(value)).toBe(500),
  );
  it('accepts a bounded configured cap', () => expect(propertyEmailHourlyCap('25')).toBe(25));
});
