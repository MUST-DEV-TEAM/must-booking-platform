'use client';

import { Badge, Button, Card, Heading, StatusBadge, Text, TextInput } from '@must/ui';
import type { CSSProperties } from 'react';

import { CopyChip, Section, Specimen } from './specimens';
import styles from './styleguide.module.css';

/**
 * PROPOSAL ONLY. Nothing here is applied to the app: these values are scoped to the preview
 * boxes below by overriding the `--must-*` custom properties on a wrapper element. Once the
 * palette is approved, the neutral values move into packages/ui/src/styles.css and each preset
 * becomes a theme override.
 */

/** Slightly cool neutral base shared by every theme. */
export const neutralBase = {
  '--must-color-canvas': '#f6f7f9',
  '--must-color-surface': '#ffffff',
  '--must-color-border': '#dde1e6',
  '--must-color-border-strong': '#c3c9d1',
  '--must-color-text-primary': '#16191d',
  '--must-color-text-secondary': '#4b5563',
  '--must-color-text-tertiary': '#667085',
} as const;

export type ThemePreset = {
  id: string;
  label: string;
  note: string;
  accent: string;
  accentHover: string;
  accentTint: string;
};

/** The only values a hotel theme changes. Status colors stay fixed so "Failed" looks the same everywhere. */
export const themePresets: readonly ThemePreset[] = [
  {
    id: 'neutral',
    label: 'Neutral (default)',
    note: 'Near-black slate, no brand hue.',
    accent: '#1f2933',
    accentHover: '#111827',
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

function themeVars(preset: ThemePreset): CSSProperties {
  // The focus-ring and a few status tokens are resolved at :root, so they are re-declared here
  // to follow the overridden accent inside the preview box.
  const focusRing = `0 0 0 2px ${neutralBase['--must-color-surface']}, 0 0 0 4px ${preset.accent}`;
  return {
    ...neutralBase,
    '--must-color-ink': preset.accent,
    '--must-color-ink-hover': preset.accentHover,
    '--must-color-surface-selected': preset.accentTint,
    '--must-color-focus-ring': preset.accent,
    '--must-focus-ring-primary': focusRing,
    '--must-focus-ring-secondary': focusRing,
    '--must-focus-ring-link': `0 0 0 2px ${preset.accent}`,
    '--must-focus-ring': focusRing,
    '--color-status-booking-checked-in-background': preset.accentTint,
    '--color-status-booking-checked-in-foreground': preset.accent,
    '--color-status-room-occupied-background': preset.accentTint,
    '--color-status-room-occupied-foreground': preset.accent,
    background: neutralBase['--must-color-canvas'],
    color: neutralBase['--must-color-text-primary'],
  } as CSSProperties;
}

/** WCAG 2.x contrast ratio between two hex colors. */
export function contrastRatio(foreground: string, background: string): number {
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

function Grade({ ratio, large = false }: { ratio: number; large?: boolean }) {
  const needed = large ? 3 : 4.5;
  const pass = ratio >= needed;
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
          <StatusBadge domain="payment" state="pending" />
          <StatusBadge domain="payment" state="failed" />
          <Badge>neutral</Badge>
        </div>
        <div className={styles.selectedRow}>Selected row</div>
      </Card>
    </div>
  );
}

const currentRoot = {
  canvas: '#f7f5ef',
  surface: '#ffffff',
  border: '#d8ded9',
  textPrimary: '#1c2723',
  textSecondary: '#5f6d67',
  textTertiary: '#6f7d76',
  ink: '#174c3c',
} as const;

const proposalRows: Array<{ token: string; current: string; proposed: string }> = [
  {
    token: '--must-color-canvas',
    current: currentRoot.canvas,
    proposed: neutralBase['--must-color-canvas'],
  },
  {
    token: '--must-color-surface',
    current: currentRoot.surface,
    proposed: neutralBase['--must-color-surface'],
  },
  {
    token: '--must-color-border',
    current: currentRoot.border,
    proposed: neutralBase['--must-color-border'],
  },
  {
    token: '--must-color-border-strong',
    current: '#c6d9d0',
    proposed: neutralBase['--must-color-border-strong'],
  },
  {
    token: '--must-color-text-primary',
    current: currentRoot.textPrimary,
    proposed: neutralBase['--must-color-text-primary'],
  },
  {
    token: '--must-color-text-secondary',
    current: currentRoot.textSecondary,
    proposed: neutralBase['--must-color-text-secondary'],
  },
  {
    token: '--must-color-text-tertiary',
    current: currentRoot.textTertiary,
    proposed: neutralBase['--must-color-text-tertiary'],
  },
  {
    token: '--must-color-ink (accent)',
    current: currentRoot.ink,
    proposed: themePresets[0].accent,
  },
  {
    token: '--must-color-surface-selected',
    current: '#e2ece7',
    proposed: themePresets[0].accentTint,
  },
];

export function ColorProposal() {
  const white = neutralBase['--must-color-surface'];
  const canvas = neutralBase['--must-color-canvas'];
  return (
    <Section
      id="color-proposal"
      title="Colors — neutral proposal"
      description="Proposal only; nothing here is applied to the app. A cool neutral base with one swappable accent, so any hotel theme sits on it cleanly."
    >
      <Specimen
        title="Current vs proposed"
        note="Left: the app today (warm cream canvas, pine green, brass focus ring). Right: the proposed neutral default."
      >
        <div className={styles.compareGrid}>
          <SampleScreen title="Today" />
          <SampleScreen style={themeVars(themePresets[0])} title="Proposed neutral" />
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Token</th>
              <th>Current</th>
              <th>Proposed</th>
            </tr>
          </thead>
          <tbody>
            {proposalRows.map((row) => (
              <tr key={row.token}>
                <td>
                  <CopyChip value={row.token} />
                </td>
                <td>
                  <span className={styles.driftSwatch} style={{ background: row.current }} />{' '}
                  {row.current}
                </td>
                <td>
                  <span className={styles.driftSwatch} style={{ background: row.proposed }} />{' '}
                  {row.proposed}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Specimen>

      <Specimen
        title="Hotel theme presets"
        note="Only the accent changes per hotel: action color, hover, selected tint and focus ring. The neutral base and status colors never change."
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
        note="Normal text needs 4.5:1. Computed from the proposed values."
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
                ['Primary text', neutralBase['--must-color-text-primary']],
                ['Secondary text', neutralBase['--must-color-text-secondary']],
                ['Tertiary text', neutralBase['--must-color-text-tertiary']],
              ] as const
            ).map(([label, color]) => (
              <tr key={label}>
                <td>{label}</td>
                <td>
                  <Grade ratio={contrastRatio(color, white)} />
                </td>
                <td>
                  <Grade ratio={contrastRatio(color, canvas)} />
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
                  <Grade ratio={contrastRatio(preset.accent, canvas)} />
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
