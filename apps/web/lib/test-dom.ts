import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

/** Small DOM helpers for component tests (no testing-library in this repo). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export type Mounted = { container: HTMLElement; root: Root; unmount: () => Promise<void> };

export async function mount(element: ReactElement): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return {
    container,
    root,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

export async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
}

export function byText(scope: ParentNode, text: string, selector = '*'): HTMLElement | null {
  return (
    [...scope.querySelectorAll<HTMLElement>(selector)].find(
      (node) => node.children.length === 0 && node.textContent?.trim() === text,
    ) ?? null
  );
}

export function button(scope: ParentNode, label: string): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (node) => node.textContent?.trim() === label || node.getAttribute('aria-label') === label,
  );
  if (!found)
    throw new Error(
      `No button "${label}". Buttons: ${[...scope.querySelectorAll('button')].map((b) => b.textContent?.trim() || b.getAttribute('aria-label')).join(' | ')}`,
    );
  return found;
}

export async function click(node: Element): Promise<void> {
  await act(async () => {
    node.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

export async function type(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): Promise<void> {
  const proto =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
