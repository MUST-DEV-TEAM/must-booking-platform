import { it, expect } from 'vitest';
import { serviceTimeColumns, selectedTimeRuns } from './service-time-columns';
const services = [
  { name: 'Lunch', days: [2], opensAt: '12:00', closesAt: '12:40', slotMinutes: 30 },
  { name: 'Dinner', days: [2], opensAt: '19:00', closesAt: '20:00', slotMinutes: 30 },
];
it('shows actual services every 15 minutes, preserving the last partial column and closed days', () => {
  const columns = serviceTimeColumns('2026-11-03', services);
  expect(columns.map((c) => c.label)).toEqual([
    '12:00',
    '12:15',
    '12:30',
    '19:00',
    '19:15',
    '19:30',
    '19:45',
  ]);
  expect(columns[2].end).toBe(760);
  expect(serviceTimeColumns('2026-11-04', services)).toEqual([]);
});
it('keeps unselected gaps out of floor periods', () => {
  const columns = serviceTimeColumns('2026-11-03', services);
  expect(selectedTimeRuns([720, 750, 1140, 1155], columns)).toEqual([
    { from: 720, to: 735 },
    { from: 750, to: 760 },
    { from: 1140, to: 1170 },
  ]);
});
