'use client';

import { Heading, Text, themePresets } from '@must/ui';
import { useEffect, useState } from 'react';

import { ColorThemes } from './color-themes';
import { Feedback } from './components';
import { FormControls } from './form-controls';
import { Foundations } from './foundations';
import { DeprecatedTokens, Planned, TokenDrift } from './reports';
import { useForcedPseudoStates } from './specimens';
import styles from './styleguide.module.css';

export const styleguideSections = [
  { id: 'color-themes', label: 'Colors: hotel themes' },
  { id: 'colors', label: 'Colors' },
  { id: 'typography', label: 'Typography' },
  { id: 'spacing', label: 'Spacing' },
  { id: 'radii', label: 'Radii' },
  { id: 'shadows', label: 'Shadows and focus rings' },
  { id: 'motion', label: 'Motion and breakpoints' },
  { id: 'buttons', label: 'Buttons' },
  { id: 'text-input', label: 'Text input' },
  { id: 'search-field', label: 'Search field' },
  { id: 'select', label: 'Select' },
  { id: 'choice-controls', label: 'Checkbox and radio' },
  { id: 'date-picker', label: 'Date picker' },
  { id: 'tabs-pagination', label: 'Tabs and pagination' },
  { id: 'feedback', label: 'Feedback' },
  { id: 'token-drift', label: 'Token drift' },
  { id: 'deprecated', label: 'Deprecated tokens' },
  { id: 'planned', label: 'Planned' },
] as const;

/** Applies a hotel theme to the whole page so every specimen can be checked under it. */
function ThemePreview() {
  const [theme, setTheme] = useState('neutral');
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'neutral') root.removeAttribute('data-theme');
    else root.dataset.theme = theme;
    return () => root.removeAttribute('data-theme');
  }, [theme]);

  return (
    <label className={styles.themePreview}>
      <span>Preview whole page as</span>
      <select onChange={(event) => setTheme(event.target.value)} value={theme}>
        {themePresets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function StyleGuide() {
  useForcedPseudoStates();

  return (
    <div className={styles.page}>
      <nav aria-label="Style guide sections" className={styles.menu}>
        <a className={styles.back} href="/platform">
          ← Platform
        </a>
        <ThemePreview />
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
