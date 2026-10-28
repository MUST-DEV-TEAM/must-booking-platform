// Writes one SVG per amenity key into the WordPress plugin so the website shows exactly the icons the dashboard
// catalog (app/dashboard/[tenantId]/amenity-icon-catalog.tsx) uses. Run after adding or changing an amenity:
//   node scripts/generate-plugin-amenity-icons.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const lucide = require('lucide-react');

const here = dirname(fileURLToPath(import.meta.url));
const catalog = readFileSync(
  join(here, '../app/dashboard/[tenantId]/amenity-icon-catalog.tsx'),
  'utf8',
);
const out = join(here, '../../wordpress-plugin/assets/img/amenities');
mkdirSync(out, { recursive: true });

let written = 0;
for (const [, key, name] of catalog.matchAll(/^\s+([A-Z_]+): \{ label: .*?, icon: (\w+) \}/gm)) {
  const Icon = lucide[name];
  if (!Icon) throw new Error(`lucide-react has no icon "${name}" (for ${key}).`);
  const svg = renderToStaticMarkup(
    React.createElement(Icon, { size: 28, strokeWidth: 1.5, color: '#1b1b1b' }),
  );
  writeFileSync(join(out, `${key.toLowerCase()}.svg`), `${svg}\n`);
  written += 1;
}
console.log(`Wrote ${written} amenity icons to ${out}`);
