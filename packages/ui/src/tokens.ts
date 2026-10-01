/** The public token version. Increment for every token addition, change, or deprecation. */
export const DESIGN_TOKEN_VERSION = '1.6.0';

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

export type StatusTokenPair = {
  background: `--color-status-${string}-background`;
  foreground: `--color-status-${string}-foreground`;
};

/** Semantic status-token pairs used by StatusBadge. Always consume both sides of a pair. */
export const statusTokenPairs = {
  booking: {
    pending: {
      background: '--color-status-booking-pending-background',
      foreground: '--color-status-booking-pending-foreground',
    },
    confirmed: {
      background: '--color-status-booking-confirmed-background',
      foreground: '--color-status-booking-confirmed-foreground',
    },
    cancelled: {
      background: '--color-status-booking-cancelled-background',
      foreground: '--color-status-booking-cancelled-foreground',
    },
    'checked-in': {
      background: '--color-status-booking-checked-in-background',
      foreground: '--color-status-booking-checked-in-foreground',
    },
    'checked-out': {
      background: '--color-status-booking-checked-out-background',
      foreground: '--color-status-booking-checked-out-foreground',
    },
    'no-show': {
      background: '--color-status-booking-no-show-background',
      foreground: '--color-status-booking-no-show-foreground',
    },
  },
  payment: {
    pending: {
      background: '--color-status-payment-pending-background',
      foreground: '--color-status-payment-pending-foreground',
    },
    paid: {
      background: '--color-status-payment-paid-background',
      foreground: '--color-status-payment-paid-foreground',
    },
    failed: {
      background: '--color-status-payment-failed-background',
      foreground: '--color-status-payment-failed-foreground',
    },
    refunded: {
      background: '--color-status-payment-refunded-background',
      foreground: '--color-status-payment-refunded-foreground',
    },
    unpaid: {
      background: '--color-status-payment-unpaid-background',
      foreground: '--color-status-payment-unpaid-foreground',
    },
  },
  room: {
    available: {
      background: '--color-status-room-available-background',
      foreground: '--color-status-room-available-foreground',
    },
    occupied: {
      background: '--color-status-room-occupied-background',
      foreground: '--color-status-room-occupied-foreground',
    },
    cleaning: {
      background: '--color-status-room-cleaning-background',
      foreground: '--color-status-room-cleaning-foreground',
    },
    maintenance: {
      background: '--color-status-room-maintenance-background',
      foreground: '--color-status-room-maintenance-foreground',
    },
    reserved: {
      background: '--color-status-room-reserved-background',
      foreground: '--color-status-room-reserved-foreground',
    },
    'out-of-service': {
      background: '--color-status-room-out-of-service-background',
      foreground: '--color-status-room-out-of-service-foreground',
    },
  },
} as const satisfies Record<string, Record<string, StatusTokenPair>>;

export type StatusBadgeDomain = keyof typeof statusTokenPairs;
export type StatusBadgeState = {
  [Domain in StatusBadgeDomain]: keyof (typeof statusTokenPairs)[Domain];
}[StatusBadgeDomain];

const statusTokenEntries: readonly DesignToken[] = Object.entries(statusTokenPairs).flatMap(
  ([domain, states]) =>
    Object.entries(states).flatMap(([state, pair]) =>
      [pair.background, pair.foreground].map((cssVariable) => ({
        cssVariable: `--must-${cssVariable.slice(2)}` as `--must-${string}`,
        description: `Status ${domain}/${state} ${cssVariable.endsWith('background') ? 'background' : 'foreground'} token.`,
        status: 'active' as const,
      })),
    ),
);

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
    cssVariable: '--must-color-accent',
    description:
      'Theme accent — primary action color, links, selection marker and focus ring. The only color a hotel theme changes. Default: near-black slate.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-accent-hover',
    description: 'Accent hover/pressed state.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-accent-tint',
    description: 'Pale accent wash behind selected items and icon chips.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-ink',
    description: 'Renamed --must-color-accent in 1.5.0 (the old deep-pine brand color).',
    status: 'deprecated',
    replacement: '--must-color-accent',
    deprecatedIn: '1.5.0',
    removeAfter: '2.0.0',
  },
  {
    cssVariable: '--must-color-ink-hover',
    description: 'Renamed --must-color-accent-hover in 1.5.0.',
    status: 'deprecated',
    replacement: '--must-color-accent-hover',
    deprecatedIn: '1.5.0',
    removeAfter: '2.0.0',
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
    cssVariable: '--must-color-surface-hover',
    description:
      'Neutral hover wash for rows, menu items and quiet buttons. Not used for selection.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-surface-selected',
    description:
      'Selected or active surface — the accent tint. Pair it with a non-color marker (accent bar, weight).',
    status: 'active',
  },
  {
    cssVariable: '--must-color-border',
    description: 'Default border color (neutral-200).',
    status: 'active',
  },
  {
    cssVariable: '--must-color-border-strong',
    description:
      'Emphasized border (neutral-300): hovered inputs, secondary buttons, dividers that need weight.',
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
  {
    cssVariable: '--must-color-accent-brass',
    description: 'Brass is retired from the palette; this alias now resolves to the warning color.',
    status: 'deprecated',
    replacement: '--must-color-warning',
    deprecatedIn: '1.5.0',
    removeAfter: '2.0.0',
  },
  {
    cssVariable: '--must-color-danger-surface',
    description: 'Pale danger wash behind failed/destructive content.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-success-surface',
    description: 'Pale success wash behind confirmed/healthy content.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-warning-surface',
    description: 'Pale warning wash behind pending/attention content.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-info-surface',
    description: 'Pale info wash behind informational content.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-notification-badge',
    description: 'Unread-notification dot/badge. A fixed signal color, never themed.',
    status: 'active',
  },
  ...(
    [
      ['50', 'page canvas'],
      ['100', 'hover wash'],
      ['200', 'default border'],
      ['300', 'strong border'],
      ['400', 'disabled/placeholder tones'],
      ['500', 'tertiary text'],
      ['600', 'secondary text'],
      ['700', 'strong secondary text'],
      ['800', 'dark surfaces'],
      ['900', 'primary text'],
      ['950', 'deepest neutral'],
    ] as const
  ).map(([step, use]) => ({
    cssVariable: `--must-neutral-${step}` as const,
    description: `Neutral scale ${step} (slightly cool grey) — ${use}. Semantic tokens point into this scale.`,
    status: 'active' as const,
  })),
  {
    cssVariable: '--must-color-chart-series-1',
    description: 'Chart series 1 — blue. Chart colors are theme-independent.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-chart-series-2',
    description: 'Chart series 2 — amber.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-chart-series-3',
    description: 'Chart series 3 — green-teal.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-chart-series-4',
    description: 'Chart series 4 — violet.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-chart-series-5',
    description: 'Chart series 5 — slate.',
    status: 'active',
  },
  {
    cssVariable: '--must-color-chart-series-6',
    description: 'Chart series 6 — cyan.',
    status: 'active',
  },
  ...statusTokenEntries,
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
  {
    cssVariable: '--must-color-focus-ring',
    description: 'Focus-ring colour; follows the theme accent.',
    status: 'active',
  },
  {
    cssVariable: '--must-shadow-focus-ring',
    description: 'Focus-ring shadow foundation: a surface-colored gap plus an accent ring.',
    status: 'active',
  },
  {
    cssVariable: '--must-focus-ring-primary',
    description: 'Focus ring for primary buttons and primary actions.',
    status: 'active',
  },
  {
    cssVariable: '--must-focus-ring-secondary',
    description: 'Focus ring for secondary buttons and form controls.',
    status: 'active',
  },
  {
    cssVariable: '--must-focus-ring-link',
    description: 'Focus ring for text links and navigation links.',
    status: 'active',
  },
  {
    cssVariable: '--must-focus-ring-danger',
    description: 'Focus ring for destructive and danger actions.',
    status: 'active',
  },
  {
    cssVariable: '--must-focus-ring',
    description: 'Legacy primary keyboard-focus ring alias.',
    status: 'active',
  },
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
  {
    cssVariable: '--must-breakpoint-mobile-max',
    description: 'Responsive contract: mobile ends at 767px.',
    status: 'active',
  },
  {
    cssVariable: '--must-breakpoint-tablet-min',
    description: 'Responsive contract: tablet starts at 768px.',
    status: 'active',
  },
  {
    cssVariable: '--must-breakpoint-laptop-min',
    description: 'Responsive contract: laptop starts at 1200px.',
    status: 'active',
  },
  {
    cssVariable: '--must-breakpoint-xl-min',
    description: 'Responsive contract: XL desktop starts at 1440px.',
    status: 'active',
  },
  {
    cssVariable: '--must-responsive-page-padding',
    description: 'Responsive page padding: 16px mobile/tablet, 24px laptop, 32px XL.',
    status: 'active',
  },
  {
    cssVariable: '--must-responsive-card-gap',
    description: 'Responsive card gap: 12px mobile/tablet, 16px laptop, 24px XL.',
    status: 'active',
  },
  {
    cssVariable: '--must-responsive-heading-size',
    description: 'Responsive heading size: 24px mobile/tablet, 28px laptop, 32px XL.',
    status: 'active',
  },
  {
    cssVariable: '--must-responsive-heading-line-height',
    description: 'Responsive heading line height: 30px mobile/tablet, 34px laptop, 38px XL.',
    status: 'active',
  },
  {
    cssVariable: '--must-responsive-body-size',
    description: 'Responsive body size: 14px mobile/tablet, 13px laptop, 14px XL.',
    status: 'active',
  },
  {
    cssVariable: '--must-responsive-body-line-height',
    description: 'Responsive body line height: 21px mobile/tablet, 20px laptop/XL.',
    status: 'active',
  },
  {
    cssVariable: '--must-responsive-touch-target',
    description: 'Responsive minimum touch target: 48px mobile, 44px tablet/laptop, 40px XL.',
    status: 'active',
  },
  {
    cssVariable: '--must-responsive-card-radius',
    description: 'Responsive card radius: 10px mobile, 12px tablet/laptop/XL.',
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
  laptopMin: 1200,
  xlMin: 1440,
} as const;

/**
 * Hotel theme presets. The values live in styles.css as `[data-theme='<id>']` blocks (one source
 * of truth); this list is the vocabulary for pickers and documentation. Apply a theme with
 * `<html data-theme="summer">`, or on any container to scope it. A theme only ever changes the
 * accent trio (--must-color-accent, -hover, -tint).
 */
export const themePresets = [
  { id: 'neutral', label: 'Neutral (default)', note: 'Near-black slate, no brand hue.' },
  { id: 'summer', label: 'Summer', note: 'Sea teal.' },
  { id: 'winter', label: 'Winter', note: 'Frost blue.' },
  { id: 'alpine', label: 'Alpine', note: 'Spruce green.' },
  { id: 'modern', label: 'Modern', note: 'Indigo.' },
] as const;

export type ThemeId = (typeof themePresets)[number]['id'];
