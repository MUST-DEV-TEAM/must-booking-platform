'use client';

import {
  breakpoints,
  Card,
  designTokens,
  Heading,
  Stack,
  statusTokenPairs,
  Text,
  typographyRoles,
} from '@must/ui';

import { CopyChip, Section, Specimen, useTokenValues } from './specimens';
import styles from './styleguide.module.css';

const tokensByPrefix = (prefix: string, exclude: readonly string[] = []) =>
  designTokens
    .filter((token) => token.status === 'active' && token.cssVariable.startsWith(prefix))
    .filter((token) => !exclude.some((part) => token.cssVariable.includes(part)))
    .map((token) => token.cssVariable);

const colorTokens = tokensByPrefix('--must-color-', ['-status-', 'focus-ring']);
const neutralTokens = tokensByPrefix('--must-neutral-');
const spaceTokens = tokensByPrefix('--must-space-');
const radiusTokens = tokensByPrefix('--must-radius-');
const shadowTokens = tokensByPrefix('--must-shadow-');
const focusTokens = [
  '--must-focus-ring-primary',
  '--must-focus-ring-secondary',
  '--must-focus-ring-link',
  '--must-focus-ring-danger',
];
const motionTokens = tokensByPrefix('--must-motion-');
const descriptionFor = (name: string) =>
  designTokens.find((token) => token.cssVariable === name)?.description ?? '';

const typographyLabels: Record<keyof typeof typographyRoles, string> = {
  pageTitle: 'Page title',
  sectionTitle: 'Section title',
  panelTitle: 'Panel title',
  body: 'Body',
  smallBody: 'Small body',
  label: 'Label',
  caption: 'Caption',
};

export function Foundations() {
  const allNames = [
    ...colorTokens,
    ...neutralTokens,
    ...spaceTokens,
    ...radiusTokens,
    ...shadowTokens,
    ...motionTokens,
    '--must-font-sans',
    ...Object.values(statusTokenPairs).flatMap((states) =>
      Object.values(states).flatMap((pair) => [pair.background, pair.foreground]),
    ),
  ];
  const values = useTokenValues(allNames);

  return (
    <>
      <Section
        id="colors"
        title="Colors"
        description="Read live from the stylesheet. Click a swatch to copy its variable name."
      >
        <div className={styles.swatchGrid}>
          {colorTokens.map((name) => (
            <div className={styles.swatch} key={name}>
              <span className={styles.swatchColor} style={{ background: `var(${name})` }} />
              <CopyChip value={name} />
              <span className={styles.swatchValue}>{values[name] || '—'}</span>
              <span className={styles.swatchNote}>{descriptionFor(name)}</span>
            </div>
          ))}
        </div>
        <Specimen
          title="Neutral scale"
          note="A slightly cool grey. The semantic tokens above (canvas, border, text) point into this scale; hotel themes never change it."
        >
          <div className={styles.pairGrid}>
            {neutralTokens.map((name) => (
              <div className={styles.swatch} key={name}>
                <span className={styles.swatchColor} style={{ background: `var(${name})` }} />
                <CopyChip value={name} />
                <span className={styles.swatchValue}>{values[name] || '—'}</span>
              </div>
            ))}
          </div>
        </Specimen>
        <Specimen
          title="Status pairs"
          note="Background and foreground always travel together; text carries the state, color only reinforces it."
        >
          <div className={styles.pairGrid}>
            {Object.entries(statusTokenPairs).flatMap(([domain, states]) =>
              Object.entries(states).map(([state, pair]) => (
                <div
                  className={styles.pair}
                  key={`${domain}-${state}`}
                  style={{
                    background: `var(${pair.background})`,
                    color: `var(${pair.foreground})`,
                  }}
                >
                  <strong>
                    {domain} / {state}
                  </strong>
                  <span>
                    <CopyChip
                      value={pair.background}
                      label={values[pair.background] || 'background'}
                    />{' '}
                    <CopyChip
                      value={pair.foreground}
                      label={values[pair.foreground] || 'foreground'}
                    />
                  </span>
                </div>
              )),
            )}
          </div>
        </Specimen>
      </Section>

      <Section
        id="typography"
        title="Typography"
        description="Manrope throughout. The type scale comes from the typography roles in @must/ui."
      >
        <Specimen title="Font family" note={descriptionFor('--must-font-sans')}>
          <p className={styles.fontSample}>
            <CopyChip value="--must-font-sans" /> {values['--must-font-sans'] || ''}
          </p>
        </Specimen>
        <Specimen title="Type scale">
          <div className={styles.typeScale}>
            {(Object.keys(typographyRoles) as Array<keyof typeof typographyRoles>).map((role) => {
              const spec = typographyRoles[role];
              return (
                <div className={styles.typeRow} key={role}>
                  <span className={styles.typeMeta}>
                    {typographyLabels[role]}
                    <small>
                      {spec.fontSize}/{spec.lineHeight} · {spec.fontWeight}
                    </small>
                  </span>
                  <span
                    style={{
                      fontSize: spec.fontSize,
                      lineHeight: `${spec.lineHeight}px`,
                      fontWeight: spec.fontWeight,
                    }}
                  >
                    Sea-view rooms and suites
                  </span>
                </div>
              );
            })}
          </div>
        </Specimen>
        <Specimen title="Heading, Text and Stack" note="The shared text and layout primitives.">
          <Stack gap="sm">
            <Heading level={1}>Heading level 1</Heading>
            <Heading level={2}>Heading level 2</Heading>
            <Heading level={3}>Heading level 3</Heading>
            <Text>Text primary — default body copy.</Text>
            <Text tone="secondary">Text secondary — supporting descriptions.</Text>
          </Stack>
        </Specimen>
        <Specimen title="Card" note="The shared surface for grouped content.">
          <Card>
            <Heading level={3}>Card title</Heading>
            <Text tone="secondary">Card body content sits on the surface token.</Text>
          </Card>
        </Specimen>
      </Section>

      <Section
        id="spacing"
        title="Spacing"
        description="The spacing scale; bars are drawn at the real size."
      >
        <div className={styles.tokenList}>
          {spaceTokens.map((name) => (
            <div className={styles.tokenRow} key={name}>
              <CopyChip value={name} />
              <span className={styles.spaceBar} style={{ width: `var(${name})` }} />
              <span className={styles.swatchValue}>{values[name]}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="radii" title="Radii">
        <div className={styles.boxGrid}>
          {radiusTokens.map((name) => (
            <div className={styles.boxSpecimen} key={name}>
              <span className={styles.radiusBox} style={{ borderRadius: `var(${name})` }} />
              <CopyChip value={name} />
              <span className={styles.swatchValue}>{values[name]}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="shadows" title="Shadows and focus rings">
        <div className={styles.boxGrid}>
          {shadowTokens.map((name) => (
            <div className={styles.boxSpecimen} key={name}>
              <span className={styles.shadowBox} style={{ boxShadow: `var(${name})` }} />
              <CopyChip value={name} />
              <span className={styles.swatchNote}>{descriptionFor(name)}</span>
            </div>
          ))}
          {focusTokens.map((name) => (
            <div className={styles.boxSpecimen} key={name}>
              <span className={styles.shadowBox} style={{ boxShadow: `var(${name})` }} />
              <CopyChip value={name} />
              <span className={styles.swatchNote}>{descriptionFor(name)}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section id="motion" title="Motion and breakpoints">
        <div className={styles.tokenList}>
          {motionTokens.map((name) => (
            <div className={styles.tokenRow} key={name}>
              <CopyChip value={name} />
              <span className={styles.swatchNote}>{descriptionFor(name)}</span>
              <span className={styles.swatchValue}>{values[name]}</span>
            </div>
          ))}
          {Object.entries(breakpoints).map(([name, value]) => (
            <div className={styles.tokenRow} key={name}>
              <CopyChip value={name} />
              <span className={styles.swatchNote}>Breakpoint</span>
              <span className={styles.swatchValue}>{value}px</span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
