import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AvailabilityGrid } from './availability-grid';
describe('AvailabilityGrid', () => {
  it('shows real stock and the rejection note without editing controls', () => {
    const html = renderToStaticMarkup(
      <AvailabilityGrid
        rows={[
          {
            id: 't',
            label: 'King',
            days: [{ date: '2035-03-30', capacity: 3, available: 0, note: 'Stop sell' }],
          },
        ]}
      />,
    );
    expect(html).toContain('King');
    expect(html).toContain('0/3');
    expect(html).toContain('title="Stop sell"');
    expect(html).not.toContain('<button');
  });
});
