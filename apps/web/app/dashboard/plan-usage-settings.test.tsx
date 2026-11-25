// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';

import { PlanUsageSettings, type PlanUsageData } from './plan-usage-settings';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
});
const plan = (over: Partial<PlanUsageData['plan']> = {}, usage = {}): PlanUsageData => ({
  plan: {
    name: 'Basic',
    maxProperties: 2,
    maxStaffSeats: 5,
    pmsEnabled: true,
    maxPmsConnectionsPerProperty: 1,
    readOnly: false,
    diningEnabled: false,
    maxVenues: null,
    ...over,
  },
  usage: { properties: 1, staffSeats: 4, venues: 0, ...usage },
});
async function mount(data: PlanUsageData | null) {
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  await act(async () =>
    root!.render(createElement(PlanUsageSettings, { data, hotel: { rooms: 12, staff: 3 } })),
  );
  return host.textContent ?? '';
}

it('shows the plan, its limits in plain words, the usage and this hotel', async () => {
  const text = await mount(plan());
  expect(text).toContain('Basic');
  expect(text).toContain('Active');
  expect(text).toContain('1 of 2');
  expect(text).toContain('4 of 5');
  expect(text).toContain('You are close to the limit.');
  expect(text).toContain('Rooms');
  expect(text).toContain('12');
  expect(text).toContain('Restaurants: not included');
  expect(text).not.toContain('You cannot switch on another restaurant');
});
it('says what is blocked at the limit and that nothing is deleted', async () => {
  const text = await mount(plan({}, { staffSeats: 5 }));
  expect(text).toContain(
    'You cannot add another staff account. Nothing you already have is deleted.',
  );
});
it('shows "No limit" for a huge limit and explains a read-only plan', async () => {
  const text = await mount(plan({ maxProperties: 100000, readOnly: true, diningEnabled: true }));
  expect(text).toContain('1 · No limit');
  expect(text).toContain('Read-only');
  expect(text).toContain('This plan is read-only');
  expect(text).toContain('Restaurants');
});
it('says so when the plan could not be loaded', async () => {
  expect(await mount(null)).toContain('The plan could not be loaded.');
});
