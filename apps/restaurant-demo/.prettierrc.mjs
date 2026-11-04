import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export default {
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  plugins: [require.resolve('prettier-plugin-astro')],
  overrides: [{ files: '*.astro', options: { parser: 'astro' } }],
};
