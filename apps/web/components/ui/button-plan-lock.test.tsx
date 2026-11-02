// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { Button } from './button';
import { PlanAccessProvider } from './plan-access';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function renderButtons(readOnly: boolean) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      createElement(
        PlanAccessProvider,
        { value: { readOnly } },
        createElement(Button, { type: 'submit' }, 'Save'),
        createElement(Button, { variant: 'destructive' }, 'Delete'),
        createElement(Button, { mutates: true }, 'Send'),
        createElement(Button, null, 'Open dialog'),
        createElement(Button, { type: 'submit', mutates: false }, 'Apply filter'),
      ),
    ),
  );
  const find = (label: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent === label)!;
  return { find, cleanup: () => act(async () => root.unmount()) };
}

describe('Button on a read-only plan', () => {
  it('locks buttons that change data and leaves the rest usable', async () => {
    const { find, cleanup } = await renderButtons(true);
    for (const label of ['Save', 'Delete', 'Send']) {
      expect(find(label).disabled).toBe(true);
      expect(find(label).title).toContain('Upgrade your plan');
    }
    expect(find('Open dialog').disabled).toBe(false);
    expect(find('Apply filter').disabled).toBe(false);
    await cleanup();
  });

  it('changes nothing on a normal plan', async () => {
    const { find, cleanup } = await renderButtons(false);
    for (const label of ['Save', 'Delete', 'Send', 'Open dialog', 'Apply filter'])
      expect(find(label).disabled).toBe(false);
    await cleanup();
  });
});
