// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

import { TenantPicker } from './tenant-picker';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('TenantPicker', () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  async function render(component: ReactNode) {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(component);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function membershipsResponse(
    memberships: Array<{ tenantId: string; organizationName: string; role: string }>,
  ) {
    return { ok: true, json: async () => ({ memberships }) };
  }

  afterEach(async () => {
    await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    replace.mockReset();
    vi.unstubAllGlobals();
  });

  it('redirects straight to the tenant dashboard when there is exactly one workspace', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          membershipsResponse([
            { tenantId: 'tenant-1', organizationName: 'Must Hotel Testing', role: 'OWNER' },
          ]),
        ),
    );

    await render(<TenantPicker />);

    expect(replace).toHaveBeenCalledWith('/dashboard/tenant-1');
    expect(container?.textContent).toBe('');
  });

  it('shows the picker when there are multiple workspaces', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        membershipsResponse([
          { tenantId: 'tenant-1', organizationName: 'Must Hotel Testing', role: 'OWNER' },
          { tenantId: 'tenant-2', organizationName: 'Second Group', role: 'STAFF' },
        ]),
      ),
    );

    await render(<TenantPicker />);

    expect(replace).not.toHaveBeenCalled();
    expect(container?.textContent).toContain('Choose a workspace');
    expect(container?.textContent).toContain('Must Hotel Testing');
    expect(container?.textContent).toContain('Second Group');
  });

  it('shows the picker with no redirect when there are no workspaces', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(membershipsResponse([])));

    await render(<TenantPicker />);

    expect(replace).not.toHaveBeenCalled();
    expect(container?.textContent).toContain('No workspaces available.');
  });
});
