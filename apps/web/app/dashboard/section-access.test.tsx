// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SectionAccess } from '../../components/ui/state-panel';
import { canAccessSection } from './dashboard-shell';
describe('finance section boundary', () => {
  it.each(['calendar', 'settings', 'emails'])(
    'shows a recoverable denied state for %s',
    (section) => {
      const allowed = canAccessSection(
        'STAFF',
        ['bookings.view', 'payments.view', 'reports.view', 'payments.refund'],
        section,
      );
      expect(allowed).toBe(false);
      const html = renderToStaticMarkup(
        createElement(
          SectionAccess,
          { allowed, backHref: '/dashboard/t?section=overview' },
          createElement('p', null, 'Private content'),
        ),
      );
      expect(html).toContain('You don&#x27;t have access to this section');
      expect(html).toContain('Back to dashboard');
      expect(html).toContain('/dashboard/t?section=overview');
      expect(html).not.toContain('Private content');
    },
  );
});
