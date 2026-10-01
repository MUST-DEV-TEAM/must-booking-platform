'use client';

import { Heading, Text } from '@must/ui';

import { ColorThemes } from './color-themes';
import { Feedback, FormControls } from './components';
import { Foundations } from './foundations';
import { DeprecatedTokens, Planned, TokenDrift } from './reports';
import { useForcedPseudoStates } from './specimens';
import styles from './styleguide.module.css';

export const styleguideSections = [
  { id: 'color-themes', label: 'Colors: base and themes' },
  { id: 'colors', label: 'Colors' },
  { id: 'typography', label: 'Typography' },
  { id: 'spacing', label: 'Spacing' },
  { id: 'radii', label: 'Radii' },
  { id: 'shadows', label: 'Shadows and focus rings' },
  { id: 'motion', label: 'Motion and breakpoints' },
  { id: 'form-controls', label: 'Form controls' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'token-drift', label: 'Token drift' },
  { id: 'deprecated', label: 'Deprecated tokens' },
  { id: 'planned', label: 'Planned' },
] as const;

export function StyleGuide() {
  useForcedPseudoStates();

  return (
    <div className={styles.page}>
      <nav aria-label="Style guide sections" className={styles.menu}>
        <a className={styles.back} href="/platform">
          ← Platform
        </a>
        <ul>
          {styleguideSections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <main className={styles.content}>
        <header className={styles.pageHeader}>
          <Text tone="secondary">INTERNAL · PLATFORM ADMINS ONLY</Text>
          <Heading>Style guide</Heading>
          <Text tone="secondary">
            Every foundation and shared component, in every state. Values are read from the code
            tokens in @must/ui, which are the source of truth.
          </Text>
        </header>
        <ColorThemes />
        <Foundations />
        <FormControls />
        <Feedback />
        <TokenDrift />
        <DeprecatedTokens />
        <Planned />
      </main>
    </div>
  );
}
