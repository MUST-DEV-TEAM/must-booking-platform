'use client';

import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';
import type { ComposeOption } from 'echarts/core';
import type { BarSeriesOption, LineSeriesOption, PieSeriesOption } from 'echarts/charts';
import type {
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption,
} from 'echarts/components';

echarts.use([
  BarChart,
  LineChart,
  PieChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export type ChartOption = ComposeOption<
  | BarSeriesOption
  | LineSeriesOption
  | PieSeriesOption
  | GridComponentOption
  | LegendComponentOption
  | TooltipComponentOption
>;

export const CHART_SERIES_TOKEN_NAMES = [
  '--color-chart-series-1',
  '--color-chart-series-2',
  '--color-chart-series-3',
  '--color-chart-series-4',
  '--color-chart-series-5',
  '--color-chart-series-6',
] as const;

const FALLBACK_CHART_SERIES_COLORS = [
  '#174c3c',
  '#c9953c',
  '#0369a1',
  '#b42318',
  '#027a48',
  '#b54708',
] as const;

export function readChartSeriesColors(): string[] {
  if (typeof document === 'undefined') return [...FALLBACK_CHART_SERIES_COLORS];
  const computed = getComputedStyle(document.documentElement);
  return CHART_SERIES_TOKEN_NAMES.map(
    (token, index) =>
      computed.getPropertyValue(token).trim() || FALLBACK_CHART_SERIES_COLORS[index],
  );
}

export function createChartTheme(colors: readonly string[]) {
  return { color: colors.slice(0, CHART_SERIES_TOKEN_NAMES.length) };
}

export function EChart({ option, height = 280 }: { option: ChartOption; height?: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = echarts.init(container, createChartTheme(readChartSeriesColors()));
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    const applyTheme = () => {
      chart.setOption({ color: readChartSeriesColors() });
    };
    const themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    applyTheme();
    return () => {
      observer.disconnect();
      themeObserver.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, true);
  }, [option]);

  return <div className="echart" ref={containerRef} style={{ height, width: '100%' }} />;
}
