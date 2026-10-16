'use client';

import {
  ArrowUpRight,
  CalendarDays,
  ChartColumn,
  Check,
  ChevronDown,
  CircleAlert,
  CircleDollarSign,
  Download,
  Filter,
  Info,
  LockKeyhole,
  MoreHorizontal,
  RefreshCw,
  Search,
} from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { PageHeader } from '../_ui/hotel';

type DateRange = 'Last 7 days' | 'Last 30 days' | 'Last 6 months' | 'Last 12 months';
type DemoContextValue = {
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  bookingFilter: string;
  setBookingFilter: (filter: string) => void;
  hiddenSeries: Set<string>;
  toggleSeries: (label: string) => void;
  feedback: string;
  setFeedback: (value: string) => void;
  resetDemo: () => void;
};
const DemoContext = createContext<DemoContextValue | null>(null);
const dateRanges: DateRange[] = ['Last 7 days', 'Last 30 days', 'Last 6 months', 'Last 12 months'];
const rangeFactors: Record<DateRange, number> = {
  'Last 7 days': 0.18,
  'Last 30 days': 0.42,
  'Last 6 months': 1,
  'Last 12 months': 1.72,
};
function useDemo() {
  const value = useContext(DemoContext);
  if (!value) throw new Error('Charts preview controls must be inside the demo context.');
  return value;
}
function rangeLabels(range: DateRange, count: number, original: string[]) {
  const labels: Record<DateRange, string[]> = {
    'Last 7 days': ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    'Last 30 days': ['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4', 'Wk 5', 'Wk 6', 'Wk 7'],
    'Last 6 months': original,
    'Last 12 months': ['12m ago', '10m ago', '8m ago', '6m ago', '4m ago', '2m ago', 'Now'],
  };
  const source = labels[range];
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = Math.round((index * (source.length - 1)) / Math.max(1, count - 1));
    return source[sourceIndex] ?? original[index] ?? String(index + 1);
  });
}
function scaleValues(values: number[], range: DateRange) {
  return values.map((value) => Math.max(1, Math.round(value * rangeFactors[range])));
}
function scaleCount(value: string, range: DateRange) {
  return Math.round(Number(value.replaceAll(',', '')) * rangeFactors[range]).toLocaleString(
    'en-US',
  );
}
function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) => row.map((cell) => '"' + cell.replaceAll('"', '""') + '"').join(','))
    .join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const palette = [
  'var(--must-color-chart-series-1)',
  'var(--must-color-chart-series-2)',
  'var(--must-color-chart-series-3)',
  'var(--must-color-chart-series-4)',
  'var(--must-color-chart-series-5)',
  'var(--must-color-chart-series-6)',
];
type Datum = { label: string; value: number; count?: string; color: string };
const booking = [
  { label: 'Confirmed', value: 68, count: '1,245', color: palette[0] },
  { label: 'Pending payment', value: 18, count: '330', color: palette[1] },
  { label: 'Cancelled', value: 9, count: '160', color: palette[2] },
  { label: 'Manual review', value: 5, count: '90', color: palette[3] },
];
const provider = [
  { label: 'Healthy', value: 64, count: '138', color: palette[0] },
  { label: 'Delayed', value: 24, count: '52', color: palette[1] },
  { label: 'Failed', value: 8, count: '17', color: palette[2] },
  { label: 'Manual review', value: 4, count: '7', color: palette[3] },
];
const payments = [
  { label: 'Verified', value: 62, count: '1,129', color: palette[0] },
  { label: 'Verification pending', value: 20, count: '365', color: palette[1] },
  { label: 'Failed', value: 10, count: '182', color: palette[2] },
  { label: 'Refunded', value: 8, count: '144', color: palette[3] },
];
const revenue = [
  { label: 'Booking value', values: [38, 58, 53, 77, 70, 91, 98], color: palette[0] },
  { label: 'Net paid', values: [28, 43, 41, 61, 58, 72, 79], color: palette[4] },
  { label: 'Refunds', values: [12, 18, 15, 23, 20, 28, 25], color: palette[1] },
];
const weeks = [
  { label: 'Created', values: [31, 49, 43, 69, 64, 78, 89], color: palette[0] },
  { label: 'Confirmed', values: [24, 36, 32, 52, 47, 60, 69], color: palette[2] },
];

function Spec({
  n,
  title,
  note,
  children,
  className = '',
}: {
  n: string;
  title: string;
  note: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={'spec-' + n} className={className}>
      <header className="mb-3 space-y-1">
        <h2 id={'spec-' + n} className="flex items-center gap-2 text-base font-bold">
          <span className="rounded bg-secondary px-2 py-1 text-[10px] font-extrabold text-primary">
            {n}
          </span>
          {title}
        </h2>
        <p className="text-xs text-muted-foreground">{note}</p>
      </header>
      {children}
    </section>
  );
}
function Box({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <Card className={'gap-4 p-4 sm:p-5 ' + className}>{children}</Card>;
}
function RangeSelect({ label = 'Date range' }: { label?: string }) {
  const { dateRange, setDateRange } = useDemo();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => dateRanges.indexOf(dateRange));
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const descriptions: Record<DateRange, string> = {
    'Last 7 days': 'Daily view · recent activity',
    'Last 30 days': 'Weekly view · recent activity',
    'Last 6 months': 'Monthly view · current season',
    'Last 12 months': 'Monthly view · year overview',
  };

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const focusOption = (index: number) => {
    const next = (index + dateRanges.length) % dateRanges.length;
    setActiveIndex(next);
    optionRefs.current[next]?.focus();
  };
  const openAt = (index: number) => {
    setActiveIndex(index);
    setOpen(true);
    window.requestAnimationFrame(() => optionRefs.current[index]?.focus());
  };
  const chooseRange = (range: DateRange) => {
    setDateRange(range);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <div
      ref={containerRef}
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          setActiveIndex(dateRanges.indexOf(dateRange));
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            openAt(dateRanges.indexOf(dateRange));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            openAt(dateRanges.length - 1);
          }
        }}
        className="inline-flex h-10 min-w-36 items-center gap-2 rounded-lg border bg-card px-3 text-left text-xs font-semibold text-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
      >
        <CalendarDays className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1">{dateRange}</span>
        <ChevronDown
          className={
            'size-3.5 shrink-0 text-muted-foreground transition-transform ' +
            (open ? 'rotate-180' : '')
          }
          aria-hidden="true"
        />
      </button>
      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border bg-card p-1.5 shadow-xl"
        >
          <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Reporting period
          </p>
          {dateRanges.map((range, index) => (
            <button
              key={range}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              type="button"
              role="option"
              aria-selected={dateRange === range}
              tabIndex={activeIndex === index ? 0 : -1}
              onFocus={() => setActiveIndex(index)}
              onClick={() => chooseRange(range)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  focusOption(index + 1);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  focusOption(index - 1);
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  focusOption(0);
                } else if (event.key === 'End') {
                  event.preventDefault();
                  focusOption(dateRanges.length - 1);
                }
              }}
              className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-foreground">{range}</span>
                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                  {descriptions[range]}
                </span>
              </span>
              {dateRange === range ? (
                <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
              ) : (
                <span className="size-4 shrink-0" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
type ChartTooltipRow = { label: string; value: number; color: string };
type ChartTooltipPoint = {
  period: string;
  x: number;
  y: number;
  rows: ChartTooltipRow[];
};

function ChartFocusTooltip({
  point,
  width,
  height,
}: {
  point: ChartTooltipPoint | null;
  width: number;
  height: number;
}) {
  if (!point) return null;
  const left = Math.min(78, Math.max(22, (point.x / width) * 100));
  const above = point.y > 68;
  const top = above ? point.y : point.y + 12;
  return (
    <div
      aria-hidden="true"
      className={
        'pointer-events-none absolute z-10 w-max max-w-52 -translate-x-1/2 rounded-lg bg-foreground px-3 py-2 text-background shadow-lg ' +
        (above ? '-translate-y-full' : '')
      }
      style={{ left: left + '%', top: (top / height) * 100 + '%' }}
    >
      <p className="mb-1 text-[10px] font-semibold text-background/70">{point.period}</p>
      <div className="space-y-1">
        {point.rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2 text-[10px]">
            <i className="size-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
            <span className="min-w-0 flex-1">{row.label}</span>
            <strong className="text-[11px]">{row.value.toLocaleString('en-US')}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
function Toolbar({ compact = false }: { compact?: boolean }) {
  const { dateRange, bookingFilter, setBookingFilter, setFeedback, resetDemo } = useDemo();
  const [filterOpen, setFilterOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const exportData = () => {
    const exportBooking =
      bookingFilter === 'All statuses'
        ? booking
        : booking
            .filter((item) => item.label === bookingFilter)
            .map((item) => ({ ...item, value: 100 }));
    downloadCsv('must-charts-demo.csv', [
      ['Date range', dateRange],
      ['Category', 'Count', 'Share'],
      ...exportBooking.map((item) => [
        item.label,
        item.count ? scaleCount(item.count, dateRange) : '',
        item.value + '%',
      ]),
      ...revenue.map((item) => [item.label, ...scaleValues(item.values, dateRange).map(String)]),
      ...payments.map((item) => [
        item.label,
        item.count ? scaleCount(item.count, dateRange) : '',
        item.value + '%',
      ]),
    ]);
    setFeedback('Illustrative data for ' + dateRange.toLowerCase() + ' downloaded as CSV.');
    setMenuOpen(false);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="mr-auto">
        <p className="text-sm font-bold">Booking value overview</p>
        <p className="text-xs text-muted-foreground">Created and confirmed bookings over time</p>
      </div>
      <RangeSelect />
      {compact && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen(!filterOpen)}
        >
          <Filter aria-hidden="true" />
          Filter
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Download chart data"
        onClick={exportData}
      >
        <Download aria-hidden="true" />
      </Button>
      <div className="relative">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="More chart options"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
        {menuOpen && (
          <div
            className="absolute right-0 z-10 mt-1 min-w-44 rounded-lg border bg-card p-1 shadow-lg"
            role="menu"
            aria-label="Chart options"
          >
            <button
              className="w-full rounded px-3 py-2 text-left text-xs hover:bg-muted"
              role="menuitem"
              onClick={exportData}
            >
              Download sample CSV
            </button>
            <button
              className="w-full rounded px-3 py-2 text-left text-xs hover:bg-muted"
              role="menuitem"
              onClick={() => {
                resetDemo();
                setFeedback('Chart controls reset to the sample view.');
                setMenuOpen(false);
              }}
            >
              Reset chart controls
            </button>
          </div>
        )}
      </div>
      {compact && filterOpen && (
        <label className="flex w-full items-center gap-2 text-xs text-muted-foreground">
          Booking status
          <select
            className="h-8 rounded-md border bg-background px-2 text-foreground"
            aria-label="Filter by booking status"
            value={bookingFilter}
            onChange={(event) => setBookingFilter(event.target.value)}
          >
            {['All statuses', ...booking.map((item) => item.label)].map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
function Legend({
  data,
  selected,
  onSelect,
}: {
  data: Datum[];
  selected?: string;
  onSelect?: (label: string) => void;
}) {
  const { dateRange } = useDemo();
  return (
    <ul className="min-w-0 flex-1 space-y-2">
      {data.map((d) => (
        <li key={d.label} className="flex items-center justify-between gap-2 text-xs">
          <button
            type="button"
            aria-pressed={selected === d.label}
            onClick={() => onSelect?.(d.label)}
            className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="flex min-w-0 items-center gap-2">
              <i className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
              <span className="truncate">{d.label}</span>
            </span>
            <span className="shrink-0 text-muted-foreground">
              <strong className="text-foreground">
                {d.count ? scaleCount(d.count, dateRange) : ''}
              </strong>{' '}
              {d.value}%
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
function SeriesLegend({ data }: { data: { label: string; color: string }[] }) {
  const { hiddenSeries, toggleSeries } = useDemo();
  return (
    <ul className="flex flex-wrap gap-4 text-xs">
      {data.map((d) => (
        <li key={d.label} className="flex items-center gap-2">
          <button
            type="button"
            aria-pressed={!hiddenSeries.has(d.label)}
            onClick={() => toggleSeries(d.label)}
            className={
              'flex items-center gap-2 rounded px-1 py-0.5 hover:bg-muted ' +
              (hiddenSeries.has(d.label) ? 'opacity-40 line-through' : '')
            }
          >
            <i className="size-2.5 rounded-full" style={{ backgroundColor: d.color }} />
            {d.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
function LinePlot({
  series,
  labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'],
  label,
}: {
  series: { label: string; values: number[]; color: string }[];
  labels?: string[];
  label: string;
}) {
  const { dateRange, hiddenSeries } = useDemo();
  const [activePoint, setActivePoint] = useState<{
    key: string;
    index: number;
    period: string;
    x: number;
    y: number;
    series: string;
  } | null>(null);
  const visibleSeries = series
    .filter((item) => !hiddenSeries.has(item.label))
    .map((item) => ({ ...item, values: scaleValues(item.values, dateRange) }));
  const displayLabels = rangeLabels(dateRange, labels.length, labels);
  if (!visibleSeries.length) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
        Turn on a series in the legend to show the chart.
      </p>
    );
  }
  const w = 720,
    h = 220,
    left = 44,
    plotW = 664,
    plotH = 166,
    max = Math.max(...visibleSeries.flatMap((s) => s.values)) * 1.16;
  const tooltipPoint: ChartTooltipPoint | null = activePoint
    ? {
        period: activePoint.period,
        x: activePoint.x,
        y: activePoint.y,
        rows: visibleSeries.map((item) => ({
          label: item.label,
          value: item.values[activePoint.index],
          color: item.color,
        })),
      }
    : null;
  const activeSummary = tooltipPoint
    ? tooltipPoint.period +
      ': ' +
      tooltipPoint.rows
        .map((row) => row.label + ' ' + row.value.toLocaleString('en-US'))
        .join(' · ')
    : 'Hover or focus a point to see exact values for that period.';
  return (
    <div className="min-w-0">
      <div className="relative">
        <svg
          className="h-48 w-full"
          viewBox={'0 0 ' + w + ' ' + h}
          preserveAspectRatio="none"
          role="group"
          aria-label={label}
        >
          {[0, 1, 2, 3].map((i) => (
            <line
              key={i}
              x1={left}
              x2={w}
              y1={10 + (plotH * i) / 3}
              y2={10 + (plotH * i) / 3}
              stroke="var(--color-border-subtle)"
              strokeDasharray="3 4"
            />
          ))}
          {visibleSeries.map((s) => {
            const pts = s.values.map((v, i) => ({
              x: left + (plotW * i) / (s.values.length - 1),
              y: 10 + plotH * (1 - v / max),
              v,
            }));
            const activeSeries = activePoint?.series === s.label;
            return (
              <g key={s.label}>
                <polyline
                  points={pts.map((p) => p.x + ',' + p.y).join(' ')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={activeSeries ? '4' : '3'}
                  opacity={activePoint ? (activeSeries ? '1' : '0.62') : '1'}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {pts.map((p, i) => {
                  const key = s.label + '-' + i;
                  const focused = activePoint?.key === key;
                  const samePeriod = activePoint?.index === i;
                  const pointLabel = displayLabels[i];
                  const activate = () =>
                    setActivePoint({
                      key,
                      index: i,
                      period: pointLabel,
                      x: p.x,
                      y: p.y,
                      series: s.label,
                    });
                  return (
                    <g key={key} opacity={activePoint && !samePeriod ? '0.28' : '1'}>
                      {samePeriod && (
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={focused ? '11' : '8'}
                          fill={s.color}
                          opacity={focused ? '0.2' : '0.12'}
                          pointerEvents="none"
                        />
                      )}
                      <circle
                        cx={p.x}
                        cy={p.y}
                        r={focused ? '7' : samePeriod ? '5' : '4'}
                        fill={s.color}
                        stroke="var(--color-surface-default)"
                        strokeWidth={focused ? '3' : '2'}
                        pointerEvents="none"
                      />
                      <circle
                        className="focus-visible:outline-none"
                        cx={p.x}
                        cy={p.y}
                        r="14"
                        fill="transparent"
                        pointerEvents="all"
                        tabIndex={0}
                        role="button"
                        aria-label={displayLabels[i] + ', ' + s.label + ': ' + p.v}
                        onPointerEnter={activate}
                        onPointerLeave={() => setActivePoint(null)}
                        onFocus={activate}
                        onBlur={() => setActivePoint(null)}
                      >
                        <title>{displayLabels[i] + ' · ' + s.label + ': ' + p.v}</title>
                      </circle>
                    </g>
                  );
                })}
              </g>
            );
          })}
          {displayLabels.map((x, i) => (
            <text
              key={x}
              x={left + (plotW * i) / (labels.length - 1)}
              y="214"
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize="10"
            >
              {x}
            </text>
          ))}
        </svg>
        <ChartFocusTooltip point={tooltipPoint} width={w} height={h} />
      </div>
      <p role="status" aria-live="polite" className="min-h-4 text-[10px] text-muted-foreground">
        {activeSummary}
      </p>
    </div>
  );
}
function BarPlot({
  series,
  labels,
  label,
}: {
  series: { label: string; values: number[]; color: string }[];
  labels: string[];
  label: string;
}) {
  const { dateRange, hiddenSeries } = useDemo();
  const [activePoint, setActivePoint] = useState<{
    key: string;
    index: number;
    period: string;
    x: number;
    y: number;
  } | null>(null);
  const visibleSeries = series
    .filter((item) => !hiddenSeries.has(item.label))
    .map((item) => ({ ...item, values: scaleValues(item.values, dateRange) }));
  const displayLabels = rangeLabels(dateRange, labels.length, labels);
  if (!visibleSeries.length) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
        Turn on a series in the legend to show the chart.
      </p>
    );
  }
  const w = 520,
    h = 190,
    left = 12,
    plotH = 142,
    groupW = 498 / displayLabels.length,
    max = Math.max(...visibleSeries.flatMap((s) => s.values)) * 1.18,
    bw = Math.min(22, groupW / (visibleSeries.length + 1));
  const tooltipPoint: ChartTooltipPoint | null = activePoint
    ? {
        period: activePoint.period,
        x: activePoint.x,
        y: activePoint.y,
        rows: visibleSeries.map((item) => ({
          label: item.label,
          value: item.values[activePoint.index],
          color: item.color,
        })),
      }
    : null;
  const activeSummary = tooltipPoint
    ? tooltipPoint.period +
      ': ' +
      tooltipPoint.rows
        .map((row) => row.label + ' ' + row.value.toLocaleString('en-US'))
        .join(' · ')
    : 'Hover or focus a bar to see exact values for that period.';
  return (
    <div className="min-w-0">
      <div className="relative">
        <svg
          className="h-44 w-full"
          viewBox={'0 0 ' + w + ' ' + h}
          preserveAspectRatio="none"
          role="group"
          aria-label={label}
        >
          {[0, 1, 2, 3].map((i) => (
            <line
              key={i}
              x1="0"
              x2={w}
              y1={10 + (plotH * i) / 3}
              y2={10 + (plotH * i) / 3}
              stroke="var(--color-border-subtle)"
              strokeDasharray="3 4"
            />
          ))}
          {displayLabels.map((month, gi) => (
            <g key={month}>
              {activePoint?.index === gi && (
                <rect
                  x={left + groupW * gi + 2}
                  y="7"
                  width={groupW - 4}
                  height={plotH + 8}
                  rx="6"
                  fill="var(--color-muted)"
                  opacity="0.55"
                  pointerEvents="none"
                />
              )}
              {visibleSeries.map((s, si) => {
                const value = s.values[gi],
                  bh = (value / max) * plotH,
                  x =
                    left +
                    groupW * gi +
                    groupW / 2 +
                    (si - (visibleSeries.length - 1) / 2) * (bw + 3) -
                    bw / 2;
                const key = s.label + '-' + gi;
                const focused = activePoint?.key === key;
                const samePeriod = activePoint?.index === gi;
                const y = 10 + plotH - bh;
                const targetWidth = Math.max(bw + 8, 28);
                const activate = () =>
                  setActivePoint({
                    key,
                    index: gi,
                    period: month,
                    x: x + bw / 2,
                    y,
                  });
                return (
                  <g key={s.label} opacity={activePoint && !samePeriod ? '0.34' : '1'}>
                    {focused && (
                      <rect
                        x={x - 4}
                        y={y - 4}
                        width={bw + 8}
                        height={bh + 8}
                        rx="6"
                        fill={s.color}
                        opacity="0.2"
                        pointerEvents="none"
                      />
                    )}
                    <rect
                      x={x}
                      y={y}
                      width={bw}
                      height={bh}
                      rx="3"
                      fill={s.color}
                      stroke={focused ? 'var(--color-foreground)' : 'none'}
                      strokeWidth={focused ? '1.5' : '0'}
                      pointerEvents="none"
                    />
                    <rect
                      className="focus-visible:outline-none"
                      x={x - (targetWidth - bw) / 2}
                      y="8"
                      width={targetWidth}
                      height={plotH + 8}
                      fill="transparent"
                      pointerEvents="all"
                      tabIndex={0}
                      role="button"
                      aria-label={month + ', ' + s.label + ': ' + value}
                      onPointerEnter={activate}
                      onPointerLeave={() => setActivePoint(null)}
                      onFocus={activate}
                      onBlur={() => setActivePoint(null)}
                    >
                      <title>{month + ' · ' + s.label + ': ' + value}</title>
                    </rect>
                  </g>
                );
              })}
              <text
                x={left + groupW * gi + groupW / 2}
                y="178"
                textAnchor="middle"
                className="fill-muted-foreground"
                fontSize="10"
              >
                {month}
              </text>
            </g>
          ))}
        </svg>
        <ChartFocusTooltip point={tooltipPoint} width={w} height={h} />
      </div>
      <p role="status" aria-live="polite" className="min-h-4 text-[10px] text-muted-foreground">
        {activeSummary}
      </p>
    </div>
  );
}
function Donut({
  data,
  total,
  label,
  selected,
  onSelect,
}: {
  data: Datum[];
  total: string;
  label: string;
  selected?: string;
  onSelect?: (label: string) => void;
}) {
  const { dateRange } = useDemo();
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null);
  const [focusedLabel, setFocusedLabel] = useState<string | null>(null);
  let offset = 0;
  const scaledTotal = scaleCount(total, dateRange);
  const selectedDatum = data.find((item) => item.label === selected) ?? data[0];
  const activeLabel = hoveredLabel ?? focusedLabel;
  const activeDatum = data.find((item) => item.label === activeLabel);
  const displayDatum = activeDatum ?? selectedDatum;
  const detailValue = (datum: Datum) =>
    datum.count ? scaleCount(datum.count, dateRange) : scaledTotal;
  return (
    <div
      className="relative size-36 shrink-0"
      onPointerEnter={() => setHoveredLabel(selectedDatum?.label ?? data[0]?.label ?? null)}
      onPointerLeave={() => setHoveredLabel(null)}
    >
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" role="group" aria-label={label}>
        <circle cx="60" cy="60" r="43" fill="none" stroke="var(--color-muted)" strokeWidth="16" />
        {data.map((d) => {
          const start = offset;
          offset += d.value;
          const focused = activeLabel === d.label;
          return (
            <circle
              className="focus-visible:outline-none"
              key={d.label}
              cx="60"
              cy="60"
              r="43"
              fill="none"
              stroke={d.color}
              strokeWidth={focused ? '25' : selectedDatum?.label === d.label ? '19' : '16'}
              opacity={
                activeLabel
                  ? focused
                    ? '1'
                    : '0.35'
                  : selected && selectedDatum?.label !== d.label
                    ? '0.55'
                    : '1'
              }
              pathLength="100"
              strokeDasharray={d.value + ' ' + (100 - d.value)}
              strokeDashoffset={-start}
              tabIndex={0}
              role="button"
              aria-pressed={selectedDatum?.label === d.label}
              aria-label={
                d.label +
                ': ' +
                (d.count ? scaleCount(d.count, dateRange) : scaledTotal) +
                ', ' +
                d.value +
                '%'
              }
              onClick={() => onSelect?.(d.label)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect?.(d.label);
                }
              }}
              onPointerEnter={() => setHoveredLabel(d.label)}
              onFocus={() => setFocusedLabel(d.label)}
              onBlur={() => setFocusedLabel(null)}
            >
              <title>{d.label + ': ' + detailValue(d) + ' · ' + d.value + '%'}</title>
            </circle>
          );
        })}
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <strong className="text-xl">
          {displayDatum ? detailValue(displayDatum) : scaledTotal}
        </strong>
        <span className="max-w-20 truncate text-[10px] text-muted-foreground">
          {displayDatum?.label ?? 'Events'}
        </span>
      </div>
      {activeDatum && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-0 z-10 w-max -translate-x-1/2 -translate-y-full rounded-md bg-foreground px-2.5 py-1.5 text-[10px] text-background shadow-lg"
        >
          <strong>{activeDatum.label}</strong> · {detailValue(activeDatum)} · {activeDatum.value}%
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {activeDatum
          ? activeDatum.label +
            ': ' +
            detailValue(activeDatum) +
            ' events, ' +
            activeDatum.value +
            '%'
          : ''}
      </span>
    </div>
  );
}
function Metric({
  title,
  value,
  delta,
  color,
}: {
  title: string;
  value: string;
  delta: string;
  color: string;
}) {
  const { dateRange } = useDemo();
  const amount = Number(value.replace(/[^0-9.]/g, ''));
  const scaledValue = Number.isFinite(amount)
    ? '€' + Math.round(amount * rangeFactors[dateRange]).toLocaleString('en-US')
    : value;
  return (
    <div className="min-w-0 rounded-lg border bg-card p-3">
      <p className="truncate text-[11px] text-muted-foreground">{title}</p>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-1">
        <strong>{scaledValue}</strong>
        <span className="text-[10px] font-semibold" style={{ color }}>
          {delta}
        </span>
      </div>
    </div>
  );
}

function LoadingChartExample({ compact = false }: { compact?: boolean }) {
  const [loading, setLoading] = useState(false);
  const simulateLoad = () => {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 1100);
  };
  return (
    <div className="space-y-2">
      {loading ? (
        <div role="status" aria-label="Loading chart data" aria-busy="true" className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="space-y-1.5">
              <div className="h-2.5 w-28 animate-pulse rounded bg-muted" />
              <div className="h-2 w-20 animate-pulse rounded bg-muted" />
            </div>
            <div className="h-7 w-20 animate-pulse rounded-md bg-muted" />
          </div>
          <div className="relative flex h-16 items-end gap-2 overflow-hidden rounded-md border bg-muted/20 px-3 pb-2">
            {[0, 1, 2, 3, 4, 5, 6].map((bar, index) => (
              <div
                key={bar}
                className="z-10 w-full animate-pulse rounded-t bg-muted"
                style={{ height: `${24 + ((index * 17 + 13) % 44)}%` }}
              />
            ))}
            <div className="absolute inset-x-2 top-1/3 border-t border-dashed" />
            <div className="absolute inset-x-2 top-2/3 border-t border-dashed" />
          </div>
          <p className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
            Loading local sample data…
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {!compact && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold">Booking volume</p>
                <p className="text-[10px] text-muted-foreground">Sample data · 7 periods</p>
              </div>
              <Badge variant="success">Ready</Badge>
            </div>
          )}
          <div className="flex h-16 items-end gap-2 rounded-md border bg-muted/20 px-3 pb-2">
            {[32, 58, 44, 72, 54, 82, 67].map((height, index) => (
              <div
                key={index}
                className="w-full rounded-t bg-primary/75 transition-[height]"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {compact ? 'Sample data ready' : 'Sample chart ready · values are illustrative'}
          </p>
        </div>
      )}
      <Button type="button" size="sm" variant="outline" disabled={loading} onClick={simulateLoad}>
        <RefreshCw className={loading ? 'animate-spin' : ''} aria-hidden="true" />
        {loading ? 'Loading sample…' : 'Preview loading state'}
      </Button>
    </div>
  );
}

function RetryChartExample({ compact = false }: { compact?: boolean }) {
  const { dateRange } = useDemo();
  const [state, setState] = useState<'error' | 'retrying' | 'ready'>('error');
  const retry = () => {
    setState('retrying');
    window.setTimeout(() => setState('ready'), 900);
  };
  return (
    <div className="space-y-3">
      {!compact && (
        <div>
          <strong className="text-sm">Revenue performance</strong>
          <p className="text-xs text-muted-foreground">
            Selected period · {dateRange.toLowerCase()}
          </p>
        </div>
      )}
      {state === 'error' && (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 rounded-lg border border-destructive/20 bg-destructive-surface/20 p-3"
        >
          <p className="flex items-center gap-2 text-xs font-bold text-destructive">
            <CircleAlert className="size-4" aria-hidden="true" />
            Chart data couldn’t load
          </p>
          <p className="text-[10px] text-muted-foreground">
            Your filters are saved. Try the local sample again.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={retry}>
            <RefreshCw aria-hidden="true" />
            Retry sample
          </Button>
        </div>
      )}
      {state === 'retrying' && (
        <p
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <RefreshCw className="size-4 animate-spin" aria-hidden="true" />
          Retrying with illustrative data…
        </p>
      )}
      {state === 'ready' && (
        <div className="space-y-2 rounded-lg border border-success/30 bg-success-surface/30 p-3">
          <p
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 text-xs font-semibold text-success"
          >
            <ChartColumn className="size-4" aria-hidden="true" />
            Sample chart is ready
          </p>
          <div className="flex h-12 items-end gap-1.5" aria-label="Loaded sample chart">
            {[35, 58, 48, 74, 62, 88].map((height, index) => (
              <div
                key={index}
                className="w-full rounded-t bg-success/70"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => setState('error')}>
            Show error example
          </Button>
        </div>
      )}
    </div>
  );
}

export default function ChartsAnalyticsPage() {
  const [dateRange, setDateRange] = useState<DateRange>('Last 6 months');
  const [bookingFilter, setBookingFilter] = useState('All statuses');
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(() => new Set());
  const [feedback, setFeedback] = useState('');
  const [bookingSelection, setBookingSelection] = useState('Confirmed');
  const [providerSelection, setProviderSelection] = useState('Healthy');
  const [paymentSelection, setPaymentSelection] = useState('Verified');
  const [providerScope, setProviderScope] = useState('All providers');
  const toggleSeries = (label: string) =>
    setHiddenSeries((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  const resetDemo = () => {
    setDateRange('Last 6 months');
    setBookingFilter('All statuses');
    setHiddenSeries(new Set());
    setBookingSelection('Confirmed');
    setProviderSelection('Healthy');
    setPaymentSelection('Verified');
    setProviderScope('All providers');
  };
  const demoContext: DemoContextValue = {
    dateRange,
    setDateRange,
    bookingFilter,
    setBookingFilter,
    hiddenSeries,
    toggleSeries,
    feedback,
    setFeedback,
    resetDemo,
  };
  const bookingData =
    bookingFilter === 'All statuses'
      ? booking
      : booking
          .filter((item) => item.label === bookingFilter)
          .map((item) => ({ ...item, value: 100 }));
  const bookingTotal =
    bookingFilter === 'All statuses'
      ? '1,825'
      : (booking.find((item) => item.label === bookingFilter)?.count ?? '0');
  const providerCounts: Record<string, string[]> = {
    'Clock PMS+': ['89', '33', '11', '4'],
    PokPay: ['49', '19', '6', '3'],
  };
  const providerData =
    providerScope === 'All providers'
      ? provider
      : provider.map((item, index) => ({
          ...item,
          count: providerCounts[providerScope]?.[index] ?? item.count ?? '0',
        }));
  const providerTotal =
    providerScope === 'All providers' ? '214' : providerScope === 'Clock PMS+' ? '137' : '77';
  return (
    <DemoContext.Provider value={demoContext}>
      <main className="min-w-0 px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <PageHeader
            title="Charts & Analytics"
            description="Reusable chart patterns for hotel booking, payment, revenue and provider operations."
            actions={<Badge variant="info">Illustrative demo data only</Badge>}
          />
          <div className="flex gap-3 rounded-lg border border-info/30 bg-info-surface/50 p-3 text-sm text-info">
            <Info className="size-4 shrink-0" aria-hidden="true" />
            <p>
              Charts use illustrative data only. Controls here do not read hotel or provider
              records.
            </p>
          </div>
          {feedback && (
            <p
              role="status"
              aria-live="polite"
              className="rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground"
            >
              {feedback}
            </p>
          )}

          <div className="grid min-w-0 gap-5 xl:grid-cols-3">
            <Spec
              n="10.1"
              title="Chart container"
              note="Responsive chart shell with clear header, visualization, actions and states."
              className="xl:col-span-2"
            >
              <Box>
                <Toolbar />
                <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                  <div className="min-w-0 space-y-3 rounded-lg border bg-card p-3">
                    <div className="flex flex-wrap justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Total booking value over time</span>
                      <Badge variant="success">
                        <ArrowUpRight /> +14.8% vs previous
                      </Badge>
                    </div>
                    <LinePlot series={[revenue[0]]} label="Booking value by month" />
                    <SeriesLegend data={[revenue[0]]} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                    <div className="space-y-2 rounded-lg border p-3">
                      <p className="text-xs font-bold">Loading state</p>
                      <LoadingChartExample compact />
                    </div>
                    <div className="rounded-lg border p-3">
                      <RetryChartExample compact />
                    </div>
                  </div>
                </div>
              </Box>
            </Spec>
            <Spec
              n="10.3"
              title="Chart legend"
              note="Each series has a consistent color, label, value and percentage."
            >
              <Box>
                <div className="rounded-lg border p-4">
                  <p className="text-sm font-bold">Booking status distribution</p>
                  <p className="mb-4 text-xs text-muted-foreground">
                    Selected range · {scaleCount('1,825', dateRange)} bookings
                  </p>
                  <Legend
                    data={booking}
                    selected={bookingSelection}
                    onSelect={setBookingSelection}
                  />
                </div>
              </Box>
            </Spec>
          </div>

          <div className="grid min-w-0 gap-5 lg:grid-cols-2">
            <Spec
              n="10.2"
              title="Chart header & controls"
              note="Date ranges, filters and export actions stay consistent."
            >
              <Box>
                <div className="rounded-lg border p-3">
                  <Toolbar compact />
                </div>
                <div className="rounded-lg border p-3">
                  <Toolbar />
                  <p className="mt-3 rounded border border-dashed p-3 text-xs text-muted-foreground">
                    Controls remain visible while chart data loads or filters apply.
                  </p>
                </div>
              </Box>
            </Spec>
            <Spec
              n="10.4"
              title="Booking volume trend"
              note="Created and confirmed booking counts over time."
            >
              <Box>
                <div className="flex flex-wrap justify-between gap-3">
                  <div>
                    <strong className="text-sm">Booking volume trend</strong>
                    <p className="text-xs text-muted-foreground">Created and confirmed by week</p>
                  </div>
                  <RangeSelect label="Booking trend date range" />
                </div>
                <LinePlot
                  series={weeks}
                  labels={['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4', 'Wk 5', 'Wk 6', 'Wk 7']}
                  label="Created and confirmed bookings by week"
                />
                <SeriesLegend data={weeks} />
              </Box>
            </Spec>
          </div>

          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <Spec
              n="10.5"
              title="Revenue & deposits"
              note="Compare booking value and deposit totals by period."
            >
              <Box>
                <div className="flex justify-between gap-3">
                  <div>
                    <strong className="text-sm">Revenue & deposits</strong>
                    <p className="text-xs text-muted-foreground">{dateRange} summary</p>
                  </div>
                  <RangeSelect label="Revenue and deposits date range" />
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Metric
                    title="Booking value"
                    value="€286,400"
                    delta="+14.8%"
                    color={palette[0]}
                  />
                  <Metric title="Deposits" value="€127,900" delta="+9.2%" color={palette[4]} />
                  <Metric title="Refunds" value="€14,500" delta="−5.7%" color={palette[1]} />
                </div>
                <BarPlot
                  series={[
                    { label: 'Booking value', values: [54, 77, 71, 48, 41, 62], color: palette[0] },
                    { label: 'Deposits', values: [39, 53, 58, 34, 31, 46], color: palette[4] },
                  ]}
                  labels={['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul']}
                  label="Monthly booking value and deposits"
                />
                <SeriesLegend
                  data={[
                    { label: 'Booking value', color: palette[0] },
                    { label: 'Deposits', color: palette[4] },
                  ]}
                />
              </Box>
            </Spec>
            <Spec
              n="10.6"
              title="Booking status distribution"
              note="Status totals with readable labels and percentages."
            >
              <Box>
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <strong className="text-sm">Booking status distribution</strong>
                    <p className="text-xs text-muted-foreground">
                      Selected range · {scaleCount('1,825', dateRange)} bookings
                    </p>
                  </div>
                  <select
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    aria-label="Booking status filter"
                    value={bookingFilter}
                    onChange={(event) => setBookingFilter(event.target.value)}
                  >
                    {['All statuses', ...booking.map((item) => item.label)].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col items-center gap-4 sm:flex-row">
                  <Donut
                    data={bookingData}
                    total={bookingTotal}
                    label="Booking status breakdown"
                    selected={bookingSelection}
                    onSelect={setBookingSelection}
                  />
                  <Legend
                    data={bookingData}
                    selected={bookingSelection}
                    onSelect={setBookingSelection}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Pair color with labels so every status stays identifiable.
                </p>
              </Box>
            </Spec>
          </div>

          <Spec
            n="10.7"
            title="Revenue performance"
            note="Compare booking value, net paid and refunds with clear KPI context."
          >
            <Box>
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <strong className="text-sm">Revenue performance</strong>
                  <p className="text-xs text-muted-foreground">
                    Booking value, net paid and refunds
                  </p>
                </div>
                <RangeSelect label="Revenue performance date range" />
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Metric
                  title="Booking value"
                  value="€286,400"
                  delta="+14.8% previous"
                  color={palette[0]}
                />
                <Metric
                  title="Net paid"
                  value="€271,900"
                  delta="+9.2% previous"
                  color={palette[4]}
                />
                <Metric title="Refunds" value="€14,500" delta="5.7% of value" color={palette[1]} />
              </div>
              <LinePlot
                series={revenue}
                label="Revenue performance by month: booking value, net paid and refunds"
              />
              <SeriesLegend data={revenue} />
            </Box>
          </Spec>

          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <Spec
              n="10.8"
              title="Booking conversion"
              note="Compare created and confirmed bookings week over week."
            >
              <Box>
                <div className="flex justify-between gap-2">
                  <div>
                    <strong className="text-sm">Booking conversion</strong>
                    <p className="text-xs text-muted-foreground">Created and confirmed by week</p>
                  </div>
                  <Badge variant="success">
                    <ArrowUpRight />
                    82.4% conversion
                  </Badge>
                </div>
                <BarPlot
                  series={weeks}
                  labels={['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5', 'Week 6', 'Week 7']}
                  label="Created and confirmed bookings across seven weeks"
                />
                <SeriesLegend data={weeks} />
              </Box>
            </Spec>
            <Spec
              n="10.9"
              title="Provider operations"
              note="Summarize provider outcomes by healthy, delayed and failed states."
            >
              <Box>
                <div className="flex justify-between gap-2">
                  <div>
                    <strong className="text-sm">Provider operations</strong>
                    <p className="text-xs text-muted-foreground">
                      {dateRange} · {providerScope.toLowerCase()}
                    </p>
                  </div>
                  <select
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    aria-label="Provider filter"
                    value={providerScope}
                    onChange={(event) => setProviderScope(event.target.value)}
                  >
                    {['All providers', 'Clock PMS+', 'PokPay'].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col items-center gap-4 sm:flex-row">
                  <Donut
                    data={providerData}
                    total={providerTotal}
                    label="Provider operation outcomes"
                    selected={providerSelection}
                    onSelect={setProviderSelection}
                  />
                  <Legend
                    data={providerData}
                    selected={providerSelection}
                    onSelect={setProviderSelection}
                  />
                </div>
                <Badge variant="warning">Delayed operations stay distinct</Badge>
              </Box>
            </Spec>
          </div>

          <Spec
            n="10.10"
            title="Payment & refund distribution"
            note="Show verified, pending, failed and refunded payments against the selected total."
          >
            <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
              <Box>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="info">Selected: {paymentSelection}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {dateRange} · {scaleCount('1,820', dateRange)} payment events
                  </span>
                </div>
                <div className="flex flex-col items-center gap-4 sm:flex-row">
                  <Donut
                    data={payments}
                    total="1,820"
                    label="Payment and refund outcomes"
                    selected={paymentSelection}
                    onSelect={setPaymentSelection}
                  />
                  <Legend
                    data={payments}
                    selected={paymentSelection}
                    onSelect={setPaymentSelection}
                  />
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs font-bold">Selected segment behavior</p>
                  <p className="text-xs text-muted-foreground">
                    Selection updates the summary while the category colors remain stable.
                  </p>
                </div>
              </Box>
              <Box className="self-start">
                <div>
                  <strong className="text-sm">Payment data semantics</strong>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Each event keeps its own outcome and financial meaning.
                  </p>
                </div>
                <dl className="divide-y rounded-lg border px-3">
                  {[
                    ['Verified', 'Provider confirmed the payment.'],
                    ['Pending', 'Awaiting confirmation; not counted as paid.'],
                    ['Failed', 'The payment attempt did not complete.'],
                    ['Refunded', 'A separate reversal of a prior payment.'],
                  ].map(([term, definition]) => (
                    <div
                      key={term}
                      className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                    >
                      <dt className="text-xs font-semibold">{term}</dt>
                      <dd className="text-xs text-muted-foreground sm:text-right">{definition}</dd>
                    </div>
                  ))}
                </dl>
                <p className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <Info className="size-3.5 shrink-0" aria-hidden="true" />
                  Refunds do not reduce the original verified count.
                </p>
              </Box>
            </div>
          </Spec>

          <Spec
            n="10.11"
            title="Chart tooltip"
            note="Exact booking, payment, refund and provider values stay available on hover or focus."
          >
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                ['Single value', '12 Jul 2026', 'Bookings · 58', '+12% versus previous period'],
                [
                  'Multi-series',
                  'May 2026',
                  'Booking value €71,000 · Net paid €63,800',
                  'Refunds €5,000',
                ],
                [
                  'Category / year',
                  'Feb 2026',
                  'Current €42,000 · Last year €38,500',
                  '+9.1% year over year',
                ],
                ['Donut segment', 'Delayed', '52 operations', '24% of total'],
              ].map(([title, date, main, detail]) => (
                <div key={title} className="space-y-2 rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs font-bold">{title}</p>
                  <div className="rounded-md border bg-card p-3 text-xs">
                    <p className="text-muted-foreground">{date}</p>
                    <p className="mt-2 font-bold">{main}</p>
                    <p className="mt-1 text-muted-foreground">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 flex gap-2 text-xs text-muted-foreground">
              <Info className="size-4" />
              Values remain understandable without color alone.
            </p>
          </Spec>

          <div className="grid gap-5 lg:grid-cols-2">
            <Spec
              n="10.12"
              title="Empty chart state"
              note="Explain why a chart is empty and offer a useful next action."
            >
              <Box className="items-center text-center">
                <Search className="size-8 text-muted-foreground" />
                <strong className="text-sm">No analytics match your filters</strong>
                <p className="text-xs text-muted-foreground">
                  Choose a wider date range or clear filters to see booking activity.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      resetDemo();
                      setFeedback('Sample charts and filters are back to their default view.');
                    }}
                  >
                    Clear filters
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setDateRange('Last 12 months');
                      setFeedback('Date range changed to the last 12 months.');
                    }}
                  >
                    Change date range
                  </Button>
                </div>
              </Box>
            </Spec>
            <Spec
              n="10.13"
              title="Chart loading state"
              note="Preview a chart-shaped skeleton, then return to a ready sample."
            >
              <Box>
                <LoadingChartExample />
              </Box>
            </Spec>
          </div>

          <Spec
            n="10.14"
            title="Error / restricted state"
            note="Preserve report context when analytics fail or financial details are restricted."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Box>
                <RetryChartExample />
              </Box>
              <Box>
                <div>
                  <strong className="text-sm">Revenue & finance analytics</strong>
                  <p className="text-xs text-muted-foreground">Restricted staff view</p>
                </div>
                <div className="flex flex-col items-center gap-2 rounded-lg border bg-muted/30 p-6 text-center">
                  <LockKeyhole className="text-muted-foreground" />
                  <strong className="text-sm">Analytics access is restricted</strong>
                  <p className="text-xs text-muted-foreground">
                    Your staff role can view bookings but does not include revenue analytics.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      window.location.assign('/design/tables');
                    }}
                  >
                    Back to bookings
                  </Button>
                </div>
              </Box>
            </div>
          </Spec>

          <div className="grid gap-3 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                icon: ChartColumn,
                title: 'Consistent containers',
                note: 'Keep title, range and actions in predictable places.',
              },
              {
                icon: CalendarDays,
                title: 'Readable data',
                note: 'Show labels, values and date context together.',
              },
              {
                icon: CircleDollarSign,
                title: 'Semantic series',
                note: 'Reuse the fixed chart colors and name every series.',
              },
              {
                icon: Filter,
                title: 'Accessible controls',
                note: 'Keep summaries and controls keyboard accessible.',
              },
            ].map(({ icon: Icon, title, note }) => (
              <div key={title} className="flex gap-3 rounded-lg bg-card p-3">
                <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-primary">
                  <Icon className="size-4" />
                </span>
                <div>
                  <p className="text-xs font-bold">{title}</p>
                  <p className="text-[10px] text-muted-foreground">{note}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </DemoContext.Provider>
  );
}
