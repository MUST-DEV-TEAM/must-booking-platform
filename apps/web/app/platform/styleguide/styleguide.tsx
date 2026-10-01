'use client';

import { Heading, Text, themePresets } from '@must/ui';
import { useEffect, useState } from 'react';

import { ColorThemes } from './color-themes';
import { Feedback } from './components';
import { FormControls } from './form-controls';
import { Cards, StackSpacing, TextAndHeadings } from './layout';
import { Foundations } from './foundations';
import { DeprecatedTokens, Planned, TokenDrift } from './reports';
import { useForcedPseudoStates } from './specimens';
import styles from './styleguide.module.css';

type StyleguideSection = { id: string; label: string };
export const styleguideGroups: ReadonlyArray<{
  label: string;
  sections: readonly StyleguideSection[];
}> = [
  {
    label: 'Foundations',
    sections: [
      { id: 'color-themes', label: 'Hotel themes' },
      { id: 'colors', label: 'Colors' },
      { id: 'typography', label: 'Typography' },
      { id: 'spacing', label: 'Spacing' },
      { id: 'radii', label: 'Radii' },
      { id: 'shadows', label: 'Shadows and focus rings' },
      { id: 'motion', label: 'Motion and breakpoints' },
    ],
  },
  {
    label: 'Text and layout',
    sections: [
      { id: 'headings-text', label: 'Headings and text' },
      { id: 'cards', label: 'Cards' },
      { id: 'stack', label: 'Stack' },
    ],
  },
  {
    label: 'Form controls',
    sections: [
      { id: 'buttons', label: 'Buttons' },
      { id: 'text-input', label: 'Text input' },
      { id: 'search-field', label: 'Search field' },
      { id: 'select', label: 'Select' },
      { id: 'choice-controls', label: 'Checkbox and radio' },
      { id: 'date-picker', label: 'Date picker' },
      { id: 'tabs-pagination', label: 'Tabs and pagination' },
    ],
  },
  {
    label: 'Feedback',
    sections: [
      { id: 'badges', label: 'Badges' },
      { id: 'alerts', label: 'Alerts' },
      { id: 'toasts', label: 'Toasts' },
      { id: 'state-panels', label: 'State panels' },
      { id: 'dialogs', label: 'Dialogs' },
    ],
  },
  {
    label: 'Health',
    sections: [
      { id: 'token-drift', label: 'Token drift' },
      { id: 'deprecated', label: 'Deprecated tokens' },
      { id: 'planned', label: 'Planned' },
    ],
  },
];

export const styleguideSections = styleguideGroups.flatMap((group) => group.sections);

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
        {styleguideGroups.map((group) => (
          <div className={styles.menuGroup} key={group.label}>
            <span className={styles.menuGroupLabel}>{group.label}</span>
            <ul>
              {group.sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>{section.label}</a>
                </li>
              ))}
            </ul>
          </div>
        ))}
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
        <TextAndHeadings />
        <Cards />
        <StackSpacing />
        <FormControls />
        <Feedback />
        <TokenDrift />
        <DeprecatedTokens />
        <Planned />
      </main>
    </div>
  );
}
