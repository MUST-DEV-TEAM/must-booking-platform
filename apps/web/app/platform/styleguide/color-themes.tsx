'use client';

import {
  Badge,
  Button,
  Card,
  Heading,
  StatusBadge,
  Text,
  TextInput,
  themePresets,
  type ThemeId,
} from '@must/ui';

import { AA_NORMAL_TEXT, contrastRatio } from './contrast';
import { CopyChip, Section, Specimen, useThemeAccents, useTokenValues } from './specimens';
import styles from './styleguide.module.css';

function Grade({ ratio }: { ratio: number }) {
  if (Number.isNaN(ratio)) return <span className={styles.note}>—</span>;
  const pass = ratio >= AA_NORMAL_TEXT;
  return (
    <span className={pass ? styles.gradePass : styles.gradeFail}>
      {ratio.toFixed(2)}:1 {pass ? 'pass' : 'fail'}
    </span>
  );
}

/** A small screen rendered inside a `data-theme` container, so it shows the theme exactly as the app will. */
function SampleScreen({ theme, title }: { theme: ThemeId; title: string }) {
  return (
    <div className={styles.sampleScreen} data-theme={theme}>
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

export function ColorThemes() {
  const accents = useThemeAccents(themePresets.map((preset) => preset.id));
  const live = useTokenValues([
    '--must-color-surface',
    '--must-color-canvas',
    '--must-color-text-primary',
    '--must-color-text-secondary',
    '--must-color-text-tertiary',
  ]);
  const white = live['--must-color-surface'] || '#ffffff';
  const canvas = live['--must-color-canvas'] ?? '';

  return (
    <Section
      id="color-themes"
      title="Colors — hotel themes"
      description="The neutral base is live app-wide. A hotel theme changes only the accent (action color, hover, selected tint and focus ring); neutrals and status colors never change."
    >
      <Specimen
        title="Theme presets"
        note="Each preview is a real [data-theme] container, so it uses the same CSS the app will. Use “Preview whole page as” in the side menu to see a theme on every component below."
      >
        <div className={styles.themeGrid}>
          {themePresets.map((preset) => (
            <div key={preset.id}>
              <div className={styles.themeLabel}>
                <strong>{preset.label}</strong>
                <span className={styles.note}>{preset.note}</span>
                <span className={styles.inlineRow}>
                  {accents[preset.id] ? (
                    <>
                      <CopyChip value={accents[preset.id].accent} />
                      <CopyChip value={accents[preset.id].hover} />
                      <CopyChip value={accents[preset.id].tint} />
                    </>
                  ) : null}
                </span>
                <CopyChip value={`data-theme="${preset.id}"`} />
              </div>
              <SampleScreen theme={preset.id} title={preset.label} />
            </div>
          ))}
        </div>
      </Specimen>

      <Specimen
        title="Contrast (WCAG 2.x)"
        note="Normal text needs 4.5:1. Computed from the live tokens, and enforced for every preset by themes.test.ts."
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
                  <Grade ratio={contrastRatio(live[token] ?? '', canvas)} />
                </td>
              </tr>
            ))}
            {themePresets.map((preset) => (
              <tr key={preset.id}>
                <td>{preset.label} accent as text</td>
                <td>
                  <Grade ratio={contrastRatio(accents[preset.id]?.accent ?? '', white)} />
                </td>
                <td>
                  <Grade ratio={contrastRatio(accents[preset.id]?.accent ?? '', canvas)} />
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
                  {preset.label}:{' '}
                  <Grade ratio={contrastRatio(white, accents[preset.id]?.accent ?? '')} />
                </td>
                <td>
                  <Grade
                    ratio={contrastRatio(
                      accents[preset.id]?.accent ?? '',
                      accents[preset.id]?.tint ?? '',
                    )}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Specimen>
    </Section>
  );
}
