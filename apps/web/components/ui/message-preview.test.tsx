// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect } from 'vitest';
import { MessagePreview } from './message-preview';
import { SettingToggle } from './setting-toggle';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
describe('Shared message controls', () => {
  it('sandboxes HTML, changes responsive width and exposes plain text', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        createElement(MessagePreview, {
          subject: 'Example',
          html: '<script>bad()</script><p>Safe text</p>',
          text: 'Safe text',
        }),
      ),
    );
    expect(host.querySelector('iframe')!.getAttribute('sandbox')).toBe('');
    await act(async () =>
      [...host.querySelectorAll('button')].find((node) => node.textContent === 'Mobile')!.click(),
    );
    expect(host.querySelector('iframe')!.className).toContain('375px');
    await act(async () =>
      [...host.querySelectorAll('button')]
        .find((node) => node.textContent === 'Plain text')!
        .click(),
    );
    expect(host.querySelector('iframe')).toBeNull();
    expect(host.querySelector('pre')!.textContent).toBe('Safe text');
    await act(async () => root.unmount());
    host.remove();
  });
  it('uses an accessible disabled toggle without changing its value', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let changed = false;
    await act(async () =>
      root.render(
        createElement(SettingToggle, {
          label: 'Mute optional emails',
          checked: false,
          disabled: true,
          onChange: () => {
            changed = true;
          },
        }),
      ),
    );
    const control = host.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
    expect(control.disabled).toBe(true);
    await act(async () => control.click());
    expect(changed).toBe(false);
    expect(host.textContent).toContain('Mute optional emails');
    await act(async () => root.unmount());
    host.remove();
  });
});
