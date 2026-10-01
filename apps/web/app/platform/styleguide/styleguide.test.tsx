// @vitest-environment jsdom

import * as ui from '@must/ui';
import axe from 'axe-core';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { styleguideCoverage } from './coverage';
import { scanTokenDrift } from './drift';
import { StyleGuide, styleguideSections } from './styleguide';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const here = dirname(fileURLToPath(import.meta.url));
const webAppDir = resolve(here, '../..');
const stylesCssPath = resolve(here, '../../../../../packages/ui/src/styles.css');
const driftPath = resolve(here, 'token-drift.generated.json');

describe('style guide coverage', () => {
  const exportedComponents = Object.keys(ui).filter((name) => /^[A-Z][a-z]/.test(name));

  it('has an entry for every component exported from @must/ui', () => {
    const missing = exportedComponents.filter((name) => !(name in styleguideCoverage));
    expect(
      missing,
      `Add these @must/ui exports to styleguideCoverage (and to the page): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('has no entry for a component that no longer exists', () => {
    const stale = Object.keys(styleguideCoverage).filter(
      (name) => !exportedComponents.includes(name),
    );
    expect(stale, `Remove stale styleguideCoverage entries: ${stale.join(', ')}`).toEqual([]);
  });
});

describe('token drift report', () => {
  it('is up to date (regenerate with UPDATE_DRIFT=1)', () => {
    const report = scanTokenDrift({
      webAppDir,
      stylesCssPath,
      registeredTokens: ui.designTokens.map((token) => token.cssVariable),
    });
    if (process.env.UPDATE_DRIFT === '1') {
      writeFileSync(driftPath, `${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    expect(JSON.parse(readFileSync(driftPath, 'utf-8'))).toEqual(report);
  });
});

describe('StyleGuide page', () => {
  async function mount() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(createElement(StyleGuide)));
    return { container, root };
  }

  it('renders every section listed in the side menu', async () => {
    const { container, root } = await mount();

    for (const section of styleguideSections)
      expect(container.querySelector(`#${section.id}`), section.label).not.toBeNull();
    expect(container.textContent).toContain('Notifications');
    expect(container.textContent).toContain('Dark theme');
    await act(async () => root.unmount());
  });

  it('shows every status badge state from the token registry', async () => {
    const { container, root } = await mount();
    const states = Object.values(ui.statusTokenPairs).reduce(
      (total, domain) => total + Object.keys(domain).length,
      0,
    );

    expect(container.querySelectorAll('#badges .must-status-badge')).toHaveLength(states);
    await act(async () => root.unmount());
  });

  it('has no accessibility violations detectable without a layout engine', async () => {
    const { container, root } = await mount();
    // jsdom has no layout, so contrast is verified visually against the token pairs instead.
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });

    expect(
      results.violations.map((violation) => `${violation.id}: ${violation.nodes.length}`),
    ).toEqual([]);
    await act(async () => root.unmount());
  }, 30_000);
});
