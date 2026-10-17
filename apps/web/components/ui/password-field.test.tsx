// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PasswordField } from './password-field';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('PasswordField', () => {
  it('generates a 16-character password with letters, digits and symbols', async () => {
    const { container, root, values } = mount('');
    const random = vi.fn((bytes: Uint8Array) => {
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 120;
      return bytes;
    });
    vi.stubGlobal('crypto', { getRandomValues: random });

    await click(container, 'Generate strong password');
    const password = values.current;
    const matchesRequirements =
      password.length === 16 &&
      /[a-z]/i.test(password) &&
      /\d/.test(password) &&
      /[^a-z0-9]/i.test(password);
    expect(matchesRequirements).toBe(true);
    expect(random).toHaveBeenCalled();
    expect(container.textContent).toContain('Password strength: Strong');
    await unmount(root);
  });

  it('toggles visibility and copies the current value without rendering it in status text', async () => {
    const value = 'Private-pass9!';
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal('navigator', { clipboard });
    const { container, root } = mount(value);
    const input = container.querySelector<HTMLInputElement>('input')!;
    expect(input.type).toBe('password');

    await click(container, 'Show password');
    expect(input.type).toBe('text');
    await click(container, 'Hide password');
    expect(input.type).toBe('password');
    await click(container, 'Copy password');

    expect(clipboard.writeText).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Password copied.');
    expect(container.textContent).not.toContain(value);
    await unmount(root);
  });
});

function mount(initial: string) {
  const values = { current: initial };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  function Harness() {
    const [value, setValue] = useState(initial);
    values.current = value;
    return createElement(PasswordField, { id: 'password', value, onChange: setValue });
  }
  act(() => {
    root.render(createElement(Harness));
  });
  return { container, root, values };
}

async function click(container: HTMLElement, label: string) {
  await act(async () => {
    const button =
      container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ??
      Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((item) =>
        item.textContent?.includes(label),
      );
    button?.click();
  });
}

async function unmount(root: ReturnType<typeof createRoot>) {
  await act(async () => root.unmount());
}
