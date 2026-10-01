import { themePresets } from '@must/ui';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { AA_NORMAL_TEXT, contrastRatio } from './contrast';

const here = dirname(fileURLToPath(import.meta.url));
const stylesCss = readFileSync(resolve(here, '../../../../../packages/ui/src/styles.css'), 'utf-8');

function declared(selector: string, token: string): string {
  const block = stylesCss.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
  const value = block.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})\\s*;`))?.[1];
  if (!value) throw new Error(`${token} not declared as a hex color in ${selector}`);
  return value;
}

const white = '#ffffff';
const canvas = declared(':root', '--must-neutral-50');

describe('hotel theme presets', () => {
  it('has a [data-theme] block in styles.css for every preset', () => {
    for (const preset of themePresets)
      expect(stylesCss, preset.id).toContain(`[data-theme='${preset.id}']`);
  });

  it('only declares presets that exist in the themePresets list', () => {
    const inCss = [...stylesCss.matchAll(/\[data-theme='([a-z-]+)'\]/g)].map((match) => match[1]);
    expect(new Set(inCss)).toEqual(new Set(themePresets.map((preset) => preset.id)));
  });

  it('keeps the default accent identical to the neutral preset', () => {
    for (const token of [
      '--must-color-accent',
      '--must-color-accent-hover',
      '--must-color-accent-tint',
    ])
      expect(declared(`\\[data-theme='neutral'\\]`, token)).toBe(declared(':root', token));
  });

  describe.each(themePresets.map((preset) => preset.id))('%s', (id) => {
    const selector = `\\[data-theme='${id}'\\]`;
    const accent = declared(selector, '--must-color-accent');
    const hover = declared(selector, '--must-color-accent-hover');
    const tint = declared(selector, '--must-color-accent-tint');

    it.each([
      ['white text on the accent', white, accent],
      ['white text on the hover accent', white, hover],
      ['accent text on white', accent, white],
      ['accent text on the canvas', accent, canvas],
      ['accent text on its selected tint', accent, tint],
    ])('%s meets 4.5:1', (_label, foreground, background) => {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
    });

    it('has a hover that is darker than the accent', () => {
      expect(contrastRatio(hover, white)).toBeGreaterThan(contrastRatio(accent, white));
    });
  });
});
