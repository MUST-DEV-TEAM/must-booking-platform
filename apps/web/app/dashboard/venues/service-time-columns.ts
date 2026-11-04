import type { TimeColumn } from '../../../components/ui/time-strip';
import type { VenueService } from './venue-api';
import { minutesOf } from './reservation-display';

/** Only the day's actual service spans, excluding gaps and closing instants. */
export function serviceTimeColumns(date: string, services: readonly VenueService[]): TimeColumn[] {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  return services
    .filter((s) => s.days.includes(day))
    .sort((a, b) => a.opensAt.localeCompare(b.opensAt))
    .flatMap((service) => {
      const columns: TimeColumn[] = [];
      for (let value = minutesOf(service.opensAt); value < minutesOf(service.closesAt); value += 15)
        columns.push({
          value,
          end: Math.min(value + 15, minutesOf(service.closesAt)),
          group: service.name,
          label: `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`,
        });
      return columns;
    });
}

/** Separate runs prevent bookings in unselected gaps from colouring a table as occupied. */
export function selectedTimeRuns(
  values: readonly number[],
  columns: readonly TimeColumn[],
): Array<{ from: number; to: number }> {
  const selected = [...new Set(values)].sort((a, b) => a - b);
  const runs: Array<{ from: number; to: number }> = [];
  for (const value of selected) {
    const column = columns.find((column) => column.value === value);
    if (!column) continue;
    const last = runs.at(-1);
    if (last && last.to === value) last.to = column.end ?? value + 15;
    else runs.push({ from: value, to: column.end ?? value + 15 });
  }
  return runs;
}
