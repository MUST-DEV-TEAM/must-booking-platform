import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { RateManagement } from './rate-management';
import { DashboardQueryProvider } from '../query-provider';

describe('RateManagement', () => {
  it('renders the tenant-scoped rate-plan entry point', () => {
    const markup = renderToStaticMarkup(
      createElement(
        DashboardQueryProvider,
        undefined,
        createElement(RateManagement, { tenantId: 'tenant-1' }),
      ),
    );

    expect(markup).toContain('Rate plans and calendar overrides');
    expect(markup).toContain('Select a property');
  });
});
