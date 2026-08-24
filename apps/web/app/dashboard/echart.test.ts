// @vitest-environment jsdom
import 'vitest-canvas-mock';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as echarts from 'echarts/core';
import {
  CHART_SERIES_TOKEN_NAMES,
  createChartTheme,
  EChart,
  readChartSeriesColors,
  type ChartOption,
} from './echart';

class ResizeObserver {
  observe() {}
  disconnect() {}
}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  CHART_SERIES_TOKEN_NAMES.forEach((token) => document.documentElement.style.removeProperty(token));
  vi.unstubAllGlobals();
});

describe('EChart theme', () => {
  it('reads all six chart tokens in their fixed order and responds to changes', () => {
    CHART_SERIES_TOKEN_NAMES.forEach((token, index) => {
      document.documentElement.style.setProperty(token, `rgb(${index} ${index} ${index})`);
    });

    expect(readChartSeriesColors()).toEqual(
      CHART_SERIES_TOKEN_NAMES.map((_, index) => `rgb(${index} ${index} ${index})`),
    );

    document.documentElement.style.setProperty(CHART_SERIES_TOKEN_NAMES[1], 'rgb(201 149 60)');
    expect(readChartSeriesColors()[1]).toBe('rgb(201 149 60)');
  });

  it('builds a theme with the supplied palette without adding a seventh colour', () => {
    const colors = ['one', 'two', 'three', 'four', 'five', 'six'];

    expect(createChartTheme(colors)).toEqual({ color: colors });
    expect(createChartTheme(colors).color).toHaveLength(6);
    expect(createChartTheme([...colors, 'seven']).color).toHaveLength(6);
  });

  it('accepts pie series in the shared chart option contract', () => {
    const option: ChartOption = {
      series: [{ data: [{ name: 'Confirmed', value: 3 }], type: 'pie' }],
    };

    expect(option.series?.[0]).toMatchObject({ type: 'pie' });
  });

  it('registers and renders a pie series through EChart', async () => {
    vi.stubGlobal('ResizeObserver', ResizeObserver);
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(EChart, {
          option: {
            series: [{ data: [{ name: 'Confirmed', value: 3 }], type: 'pie' }],
          },
        }),
      );
    });

    const chartElement = container.querySelector('.echart');
    expect(chartElement).not.toBeNull();
    const chart = echarts.getInstanceByDom(chartElement!);
    expect(chart).toBeDefined();
    expect(chart?.getOption().series[0]).toMatchObject({
      type: 'pie',
    });

    await act(async () => root.unmount());
  });
});
