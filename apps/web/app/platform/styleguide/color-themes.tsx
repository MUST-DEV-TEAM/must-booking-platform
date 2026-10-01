'use client';

import { Badge, Button, Card, Heading, StatusBadge, Text, TextInput } from '@must/ui';
import type { CSSProperties } from 'react';

import { CopyChip, Section, Specimen, useTokenValues } from './specimens';
import styles from './styleguide.module.css';

/**
 * The neutral base is applied app-wide (packages/ui/src/styles.css). A hotel theme only changes
 * the accent, so each preview box below overrides just the accent tokens on a wrapper element.
 * The presets live here until the theme mechanism (a `data-theme` attribute) moves them into
 * styles.css.
 */

export type ThemePreset = {
  id: string;
  label: string;
  note: string;
  accent: string;
  accentHover: string;
  accentTint: string;
};

export const themePresets: readonly ThemePreset[] = [
  {
    id: 'neutral',
    label: 'Neutral (default)',
    note: 'Near-black slate, no brand hue.',
    accent: '#2b3640',
    accentHover: '#1a2128',
    accentTint: '#e8ebef',
  },
  {
    id: 'summer',
    label: 'Summer',
    note: 'Sea teal.',
    accent: '#0f766e',
    accentHover: '#115e59',
    accentTint: '#e3f3f1',
  },
  {
    id: 'winter',
    label: 'Winter',
    note: 'Frost blue.',
    accent: '#1d4ed8',
    accentHover: '#1e40af',
    accentTint: '#e8eefc',
  },
  {
    id: 'alpine',
    label: 'Alpine',
    note: 'Spruce green.',
    accent: '#166534',
    accentHover: '#14532d',
    accentTint: '#e5f2e9',
  },
  {
    id: 'modern',
    label: 'Modern',
    note: 'Indigo.',
    accent: '#4338ca',
    accentHover: '#3730a3',
    accentTint: '#ececfb',
  },
];

/** Tokens that are resolved at :root and so must be re-declared inside a scoped preview box. */
function accentVars(accent: string, accentHover: string, accentTint: string): CSSProperties {
  const ring = `0 0 0 2px #ffffff, 0 0 0 4px ${accent}`;
  return {
    '--must-color-accent': accent,
    '--must-color-accent-hover': accentHover,
    '--must-color-accent-tint': accentTint,
    '--must-color-surface-selected': accentTint,
    '--must-color-focus-ring': accent,
    '--must-shadow-focus-ring': ring,
    '--must-focus-ring-primary': ring,
    '--must-focus-ring-secondary': ring,
    '--must-focus-ring-danger': ring,
    '--must-focus-ring': ring,
    '--must-focus-ring-link': `0 0 0 2px ${accent}`,
    '--color-status-booking-checked-in-background': accentTint,
    '--color-status-booking-checked-in-foreground': accent,
    '--color-status-room-occupied-background': accentTint,
    '--color-status-room-occupied-foreground': accent,
  } as CSSProperties;
}

function themeVars(preset: ThemePreset): CSSProperties {
  return accentVars(preset.accent, preset.accentHover, preset.accentTint);
}

/** The palette this app shipped with before the neutral base (warm cream canvas, pine, brass focus). */
const previousPalette = {
  canvas: '#f7f5ef',
  border: '#d8ded9',
  borderStrong: '#c6d9d0',
  textPrimary: '#1c2723',
  textSecondary: '#5f6d67',
  textTertiary: '#6f7d76',
  accent: '#174c3c',
  accentHover: '#103a2e',
  accentTint: '#e2ece7',
} as const;

function previousVars(): CSSProperties {
  const brassRing = '0 0 0 2px #ffffff, 0 0 0 4px #c9953c';
  return {
    ...accentVars(previousPalette.accent, previousPalette.accentHover, previousPalette.accentTint),
    '--must-color-canvas': previousPalette.canvas,
    '--must-color-surface-hover': previousPalette.canvas,
    '--must-color-border': previousPalette.border,
    '--must-color-border-strong': previousPalette.borderStrong,
    '--must-color-text-primary': previousPalette.textPrimary,
    '--must-color-text-secondary': previousPalette.textSecondary,
    '--must-color-text-tertiary': previousPalette.textTertiary,
    '--must-color-focus-ring': '#c9953c',
    '--must-shadow-focus-ring': brassRing,
    '--must-focus-ring-primary': brassRing,
    '--must-focus-ring-secondary': brassRing,
    '--must-focus-ring': brassRing,
    '--must-focus-ring-link': '0 0 0 2px #c9953c',
  } as CSSProperties;
}

/** WCAG 2.x contrast ratio between two hex colors; NaN when either value is not a hex color. */
export function contrastRatio(foreground: string, background: string): number {
  // Computed custom properties can come back as #fff, so expand 3-digit hex first.
  const expand = (value: string) =>
    /^#[0-9a-fA-F]{3}$/.test(value)
      ? `#${value
          .slice(1)
          .split('')
          .map((char) => char + char)
          .join('')}`
      : value;
  foreground = expand(foreground);
  background = expand(background);
  const isHex = (value: string) => /^#[0-9a-fA-F]{6}$/.test(value);
  if (!isHex(foreground) || !isHex(background)) return Number.NaN;
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => {
      const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function Grade({ ratio }: { ratio: number }) {
  if (Number.isNaN(ratio)) return <span className={styles.note}>—</span>;
  const pass = ratio >= 4.5;
  return (
    <span className={pass ? styles.gradePass : styles.gradeFail}>
      {ratio.toFixed(2)}:1 {pass ? 'pass' : 'fail'}
    </span>
  );
}

function SampleScreen({ style, title }: { style?: CSSProperties; title: string }) {
  return (
    <div className={styles.sampleScreen} style={style}>
      <Card>
        <Heading level={3}>{title}</Heading>
        <Text tone="secondary">Deluxe Suite Sea View · 12–15 Oct · 2 guests</Text>
        <div className={styles.inlineRow}>
          <Button>Confirm booking</Button>
          <Button variant="secondary">Cancel</Button>
          <Button className="sg-focus" variant="secondary">
            Focused
          </Button>
        </div>
        <TextInput className="sg-focus" defaultValue="Maria Rossi" label="Guest name" />
        <div className={styles.inlineRow}>
          <StatusBadge domain="booking" state="confirmed" />
          <StatusBadge domain="booking" state="checked-in" />
          <StatusBadge domain="booking" state="no-show" />
          <StatusBadge domain="payment" state="pending" />
          <StatusBadge domain="payment" state="failed" />
          <Badge>neutral</Badge>
        </div>
        <div className={styles.hoverRow}>Hovered row (neutral wash)</div>
        <div className={styles.selectedRow}>Selected row (accent tint + bar)</div>
      </Card>
    </div>
  );
}

const baseTokens = [
  { token: '--must-color-canvas', previous: previousPalette.canvas },
  { token: '--must-color-border', previous: previousPalette.border },
  { token: '--must-color-border-strong', previous: previousPalette.borderStrong },
  { token: '--must-color-text-primary', previous: previousPalette.textPrimary },
  { token: '--must-color-text-secondary', previous: previousPalette.textSecondary },
  { token: '--must-color-text-tertiary', previous: previousPalette.textTertiary },
  { token: '--must-color-accent', previous: previousPalette.accent },
  { token: '--must-color-surface-selected', previous: previousPalette.accentTint },
] as const;

export function ColorThemes() {
  const live = useTokenValues([
    ...baseTokens.map((row) => row.token),
    '--must-color-surface',
    '--must-color-accent-tint',
  ]);
  const white = live['--must-color-surface'] || '#ffffff';
  const canvas = live['--must-color-canvas'];

  return (
    <Section
      id="color-themes"
      title="Colors — neutral base and hotel themes"
      description="The neutral base is live app-wide. A hotel theme changes only the accent; neutrals and status colors never change."
    >
      <Specimen
        title="Previous palette vs now"
        note="Left: the warm palette the app shipped with (cream canvas, pine, brass focus ring). Right: the applied neutral default."
      >
        <div className={styles.compareGrid}>
          <SampleScreen style={previousVars()} title="Previous (warm)" />
          <SampleScreen title="Now (neutral)" />
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Token</th>
              <th>Previous</th>
              <th>Now</th>
            </tr>
          </thead>
          <tbody>
            {baseTokens.map((row) => (
              <tr key={row.token}>
                <td>
                  <CopyChip value={row.token} />
                </td>
                <td>
                  <span className={styles.driftSwatch} style={{ background: row.previous }} />{' '}
                  {row.previous}
                </td>
                <td>
                  <span
                    className={styles.driftSwatch}
                    style={{ background: `var(${row.token})` }}
                  />{' '}
                  {live[row.token] || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Specimen>

      <Specimen
        title="Hotel theme presets"
        note="Preview only: a hotel will pick one of these (a custom color comes later). Each changes just the accent, its hover, its selected tint and the focus ring."
      >
        <div className={styles.themeGrid}>
          {themePresets.map((preset) => (
            <div key={preset.id}>
              <div className={styles.themeLabel}>
                <strong>{preset.label}</strong>
                <span className={styles.note}>{preset.note}</span>
                <span className={styles.inlineRow}>
                  <CopyChip value={preset.accent} />
                  <CopyChip value={preset.accentHover} />
                  <CopyChip value={preset.accentTint} />
                </span>
              </div>
              <SampleScreen style={themeVars(preset)} title={preset.label} />
            </div>
          ))}
        </div>
      </Specimen>

      <Specimen
        title="Contrast (WCAG 2.x)"
        note="Normal text needs 4.5:1. Neutral rows are computed from the live tokens."
      >
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Pair</th>
              <th>On white surface</th>
              <th>On canvas</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ['Primary text', '--must-color-text-primary'],
                ['Secondary text', '--must-color-text-secondary'],
                ['Tertiary text', '--must-color-text-tertiary'],
              ] as const
            ).map(([label, token]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>
                  <Grade ratio={contrastRatio(live[token] ?? '', white)} />
                </td>
                <td>
                  <Grade ratio={contrastRatio(live[token] ?? '', canvas ?? '')} />
                </td>
              </tr>
            ))}
            {themePresets.map((preset) => (
              <tr key={preset.id}>
                <td>{preset.label} accent as text</td>
                <td>
                  <Grade ratio={contrastRatio(preset.accent, white)} />
                </td>
                <td>
                  <Grade ratio={contrastRatio(preset.accent, canvas ?? '')} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Button text (white) on accent</th>
              <th>Accent on its selected tint</th>
            </tr>
          </thead>
          <tbody>
            {themePresets.map((preset) => (
              <tr key={preset.id}>
                <td>
                  {preset.label}: <Grade ratio={contrastRatio(white, preset.accent)} />
                </td>
                <td>
                  <Grade ratio={contrastRatio(preset.accent, preset.accentTint)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Specimen>
    </Section>
  );
}
