// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { it, expect } from 'vitest';
import { TextComparison } from './text-comparison';
it('shows both actual versions as escaped text', async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'),
    root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        createElement(TextComparison, { before: '<script>old</script>', after: 'New text' }),
      ),
    );
    expect(host.querySelectorAll('pre')).toHaveLength(2);
    expect(host.textContent).toContain('<script>old</script>');
    expect(host.querySelector('script')).toBeNull();
  } finally {
    await act(async () => root.unmount());
  }
});
