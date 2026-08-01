/** The public token version. Increment for every token addition, change, or deprecation. */
export const DESIGN_TOKEN_VERSION = '1.0.0';

export type TokenStatus = 'active' | 'deprecated';

export type DesignToken = {
  cssVariable: `--must-${string}`;
  description: string;
  status: TokenStatus;
  /** Required once `status` is `'deprecated'`: the token to migrate consumers to. */
  replacement?: `--must-${string}`;
  /** Required once `status` is `'deprecated'`: the token version the deprecation started in. */
  deprecatedIn?: string;
  /** Required once `status` is `'deprecated'`: the next major version it's removed in. */
  removeAfter?: string;
};

/**
 * Public token registry — the stable API surface for `packages/ui` consumers, sourced from the
 * Figma "00 — Base & Components" file (Foundation reviewed, v1.2). A token is never silently
 * renamed or removed: mark it `deprecated` with a `replacement`, keep both live for at least one
 * minor version, and only delete it in the next major version bump.
 *
 * Example of retiring a token later:
 * { cssVariable: '--must-color-ink', status: 'deprecated', replacement: '--must-color-text',
 *   deprecatedIn: '1.3.0', removeAfter: '2.0.0' }
 */
export const designTokens: readonly DesignToken[] = [
  {
    cssVariable: '--must-color-ink',
    description: 'color/action/primary — primary brand/action color (deep pine).',
    status: 'active',
  },
  {
    cssVariable: '--must-color-ink-hover',
    description: 'color/action/primary-hover.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-text-primary',
    description: 'color/text/primary — default foreground text.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-text-secondary',
    description: 'color/text/secondary — secondary descriptions.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-text-tertiary',
    description: 'color/text/tertiary — metadata and quiet labels.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-surface',
    description: 'color/surface/default — default cards and controls.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-canvas',
    description: 'color/surface/canvas — application background.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-surface-selected',
    description: 'color/surface/selected — selected or active surface.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-border',
    description: 'color/neutral/200 — default border color.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-border-strong',
    description: 'color/pine/200 — emphasized/brand-tinted border.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-danger',
    description: 'color/status/danger/foreground — failed or destructive.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-success',
    description: 'color/status/success/foreground — completed or healthy.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-warning',
    description: 'color/status/warning/foreground — waiting or attention.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-info',
    description: 'color/status/information/foreground — neutral information.',
    status: 'active',
  },
  { cssVariable: '--must-space-2', description: '2px — optical spacing only.', status: 'active' },
  { cssVariable: '--must-space-4', description: '4px — control rhythm.', status: 'active' },
  {
    cssVariable: '--must-space-6',
    description: '6px — exceptional compact alignment only, not a default rhythm.',
    status: 'active',
  },
  { cssVariable: '--must-space-8', description: '8px — control rhythm.', status: 'active' },
  {
    cssVariable: '--must-space-12',
    description: '12px — compact rows and cards.',
    status: 'active',
  },
  {
    cssVariable: '--must-space-16',
    description: '16px — compact rows and cards.',
    status: 'active',
  },
  { cssVariable: '--must-space-20', description: '20px.', status: 'active' },
  { cssVariable: '--must-space-24', description: '24px — panels.', status: 'active' },
  {
    cssVariable: '--must-space-32',
    description: '32px — page and section spacing.',
    status: 'active',
  },
  {
    cssVariable: '--must-space-40',
    description: '40px — page and section spacing.',
    status: 'active',
  },
  {
    cssVariable: '--must-space-48',
    description: '48px — page and section spacing.',
    status: 'active',
  },
  {
    cssVariable: '--must-space-64',
    description: '64px — page and section spacing.',
    status: 'active',
  },
  {
    cssVariable: '--must-radius-control',
    description: 'radius/control — 8px, compact controls (icon buttons, badges).',
    status: 'active',
  },
  {
    cssVariable: '--must-radius-input',
    description: 'radius/input — 12px, inputs and buttons.',
    status: 'active',
  },
  {
    cssVariable: '--must-radius-card',
    description: 'radius/card — 16px, cards and panels.',
    status: 'active',
  },
  {
    cssVariable: '--must-radius-pill',
    description: 'radius/pill — 999px, status badges and pills.',
    status: 'active',
  },
  {
    cssVariable: '--must-shadow-float',
    description: 'Soft shadow — dropdowns, popovers, drawers.',
    status: 'active',
  },
  {
    cssVariable: '--must-shadow-modal',
    description: 'Stronger shadow — modals and blocking overlays only.',
    status: 'active',
  },
  { cssVariable: '--must-focus-ring', description: 'Keyboard-focus ring.', status: 'active' },
  {
    cssVariable: '--must-font-sans',
    description:
      'Manrope — the brand typeface. `apps/web` must load the Manrope font (e.g. `next/font/google`); this token only sets the CSS stack, it does not load the font file.',
    status: 'active',
  },
  {
    cssVariable: '--must-motion-fast',
    description: '120ms — hover and focus.',
    status: 'active',
  },
  {
    cssVariable: '--must-motion-normal',
    description: '180ms — menus and tooltips.',
    status: 'active',
  },
  {
    cssVariable: '--must-motion-slow',
    description: '240ms — drawers and overlays.',
    status: 'active',
  },
] as const;

/** Resolves a token to its live replacement, following the deprecation chain if one exists. */
export function resolveToken(cssVariable: string): string {
  const token = designTokens.find((entry) => entry.cssVariable === cssVariable);
  if (!token || token.status === 'active' || !token.replacement) return cssVariable;
  return resolveToken(token.replacement);
}

/**
 * Typography roles from the Figma foundations page, all set in Manrope. `Display` (32/40) is
 * intentionally not exposed as a `Heading` level — it's reserved for KPI/hero numerals, use the
 * numeric utility classes for that instead of a heading tag.
 */
export const typographyRoles = {
  pageTitle: { fontSize: 28, lineHeight: 36, fontWeight: 700 },
  sectionTitle: { fontSize: 24, lineHeight: 32, fontWeight: 700 },
  panelTitle: { fontSize: 20, lineHeight: 28, fontWeight: 600 },
  body: { fontSize: 14, lineHeight: 20, fontWeight: 400 },
  smallBody: { fontSize: 13, lineHeight: 18, fontWeight: 400 },
  label: { fontSize: 12, lineHeight: 16, fontWeight: 600 },
  caption: { fontSize: 11, lineHeight: 16, fontWeight: 500 },
} as const;

export const breakpoints = {
  mobileMax: 767,
  tabletMin: 768,
  desktopMin: 1024,
} as const;
