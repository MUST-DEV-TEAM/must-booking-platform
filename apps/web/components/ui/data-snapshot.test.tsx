// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { DataSnapshot } from './data-snapshot';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it('shows missing evidence explicitly and renders structured evidence as escaped text', async () => {
  const root = createRoot(document.body.appendChild(document.createElement('div')));
  try {
    await act(async () =>
      root.render(createElement(DataSnapshot, { title: 'Before', value: null })),
    );
    expect(document.body.textContent).toContain('Not recorded');
    await act(async () =>
      root.render(
        createElement(DataSnapshot, {
          title: 'Before',
          value: { html: '<script>unsafe()</script>', amount: '100.00' },
        }),
      ),
    );
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('pre')?.textContent).toContain('<script>');
    expect(document.body.textContent).toContain('100.00');
  } finally {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  }
});
