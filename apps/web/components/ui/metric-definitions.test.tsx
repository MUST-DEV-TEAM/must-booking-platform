// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MetricDefinitions } from './metric-definitions';

describe('shared MetricDefinitions', () => {
  it('shows supplied formula, date basis, currency, timezone, source and limitations', () => {
    const html = renderToStaticMarkup(
      createElement(MetricDefinitions, {
        timezone: 'Europe/Tirane',
        basis: 'Synced from Clock',
        definitions: [
          {
            key: 'adr',
            label: 'ADR',
            formula: 'Room revenue / sold nights',
            dateBasis: 'Stay night',
            currencyBasis: 'One ISO currency',
            source: 'Immutable snapshots',
            limitations: 'Unknown when missing',
          },
        ],
      }),
    );
    for (const text of [
      'ADR',
      'Room revenue / sold nights',
      'Stay night',
      'One ISO currency',
      'Europe/Tirane',
      'Synced from Clock',
      'Immutable snapshots',
      'Unknown when missing',
    ])
      expect(html).toContain(text);
  });
  it('shows an honest empty state without inventing formulas', () => {
    const html = renderToStaticMarkup(
      createElement(MetricDefinitions, {
        timezone: 'UTC',
        basis: 'Local records',
        definitions: [],
      }),
    );
    expect(html).toContain('No metric definitions available');
    expect(html).not.toContain('ADR');
  });
});
