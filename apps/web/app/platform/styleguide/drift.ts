import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Node-only scanner behind the "Token drift" report. It runs in the test suite (never in the
 * browser) and its result is checked in as token-drift.generated.json, which the page imports.
 * `styleguide.test.tsx` fails when the JSON is stale; regenerate with UPDATE_DRIFT=1.
 */
export type HexUse = {
  line: number;
  hex: string;
  nearestToken: string;
  exact: boolean;
};
export type DriftReport = {
  totals: { files: number; hardcodedColors: number; tokenReferences: number };
  files: Array<{ file: string; uses: HexUse[] }>;
  undocumentedTokens: string[];
};

const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

function normalizeHex(hex: string): string {
  const value = hex.slice(1).toLowerCase();
  const six =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value.slice(0, 6);
  return `#${six}`;
}

function rgb(hex: string): [number, number, number] {
  const value = normalizeHex(hex).slice(1);
  return [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function distance(a: string, b: string): number {
  const [r1, g1, b1] = rgb(a);
  const [r2, g2, b2] = rgb(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

function listCss(dir: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'node_modules' && entry !== '.next') output.push(...listCss(path));
    } else if (entry.endsWith('.css')) {
      output.push(path);
    }
  }
  return output;
}

/** Hex-valued `--must-color-*` tokens declared in the shared stylesheet. */
function colorTokenValues(stylesCss: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const match of stylesCss.matchAll(
    /(--must-color-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g,
  ))
    tokens.set(match[1], normalizeHex(match[2]));
  return tokens;
}

export function scanTokenDrift(options: {
  webAppDir: string;
  stylesCssPath: string;
  registeredTokens: readonly string[];
}): DriftReport {
  const stylesCss = readFileSync(options.stylesCssPath, 'utf-8');
  const tokens = colorTokenValues(stylesCss);
  const files: DriftReport['files'] = [];
  let tokenReferences = 0;

  for (const path of listCss(options.webAppDir)) {
    // The style guide's own stylesheet is not product UI.
    if (path.includes(`${sep}styleguide${sep}`)) continue;
    const source = readFileSync(path, 'utf-8');
    tokenReferences += (source.match(/var\(--must-/g) ?? []).length;
    const uses: HexUse[] = [];
    source.split(/\r?\n/).forEach((text, index) => {
      const code = text.replace(/\/\*.*?\*\//g, '');
      for (const match of code.matchAll(HEX)) {
        const hex = normalizeHex(match[0]);
        let nearest = '';
        let best = Infinity;
        for (const [name, value] of tokens) {
          const d = distance(hex, value);
          if (d < best) {
            best = d;
            nearest = name;
          }
        }
        uses.push({ line: index + 1, hex, nearestToken: nearest, exact: best === 0 });
      }
    });
    if (uses.length)
      files.push({ file: relative(options.webAppDir, path).split(sep).join('/'), uses });
  }

  const declared = [...stylesCss.matchAll(/^\s*(--must-[a-z0-9-]+)\s*:/gm)].map(
    (match) => match[1],
  );
  const registered = new Set(options.registeredTokens);
  const undocumentedTokens = [...new Set(declared)].filter((name) => !registered.has(name)).sort();

  return {
    totals: {
      files: files.length,
      hardcodedColors: files.reduce((sum, entry) => sum + entry.uses.length, 0),
      tokenReferences,
    },
    files: files.sort((a, b) => b.uses.length - a.uses.length || a.file.localeCompare(b.file)),
    undocumentedTokens,
  };
}
