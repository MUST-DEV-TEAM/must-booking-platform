import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      'apps/wordpress-plugin/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['infrastructure/**/*.mjs', 'apps/web/e2e/**/*.mjs', 'apps/api/scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
  {
    // Dates are asked for with the shared calendar (DateField), never with a plain browser date box.
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: ['apps/web/**/*.test.{ts,tsx}', 'apps/web/app/design/**', 'apps/web/e2e/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "JSXAttribute[name.name='type'][value.value=/^(date|datetime-local|week)$/]",
          message:
            'Use <DateField> (components/ui/date-field) for dates, so every calendar looks and behaves the same.',
        },
      ],
    },
  },
  eslintConfigPrettier,
);
