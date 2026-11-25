// @vitest-environment jsdom
import { expect, it } from 'vitest';

// Loaded first on purpose: without it the test runner loads a second copy of React and every hook fails.
import '../../app/dashboard/settings-areas';
import { SetupGuide } from './setup-guide';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it('shows a tick for a finished step and a red number with a button for an unfinished one', async () => {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <SetupGuide
        title="Set up your hotel"
        description="2 of 3 done."
        steps={[
          { key: 'a', label: 'Hotel profile', done: true, href: '/a', action: 'Set up' },
          { key: 'b', label: 'Payment method', done: false, href: '/b', action: 'Fix' },
          { key: 'c', label: 'Website connection', done: false, href: '/c', action: 'Set up' },
        ]}
        headerAction={<button>Hide for now</button>}
      />,
    ),
  );
  const rows = [...host.querySelectorAll('li')];
  expect(rows).toHaveLength(3);
  // Finished: a tick, no button. Unfinished: its own number and a link to finish it.
  expect(rows[0]!.querySelector('[aria-label="Done"]')?.textContent).toBe('✓');
  expect(rows[0]!.querySelector('a')).toBeNull();
  expect(rows[1]!.querySelector('[aria-label="Step 2, not done"]')?.textContent).toBe('2');
  expect(rows[1]!.querySelector('a')?.textContent).toBe('Fix');
  expect(rows[1]!.querySelector('a')?.getAttribute('href')).toBe('/b');
  expect(rows[2]!.querySelector('[aria-label="Step 3, not done"]')?.textContent).toBe('3');
  expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('33');
  expect(host.textContent).toContain('Hide for now');
  await act(async () => root.unmount());
  host.remove();
});
