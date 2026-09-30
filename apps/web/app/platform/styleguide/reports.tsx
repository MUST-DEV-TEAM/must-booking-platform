'use client';

import { designTokens } from '@must/ui';

import { styleguideCoverage } from './coverage';
import type { DriftReport } from './drift';
import { CopyChip, Section } from './specimens';
import styles from './styleguide.module.css';
import driftReport from './token-drift.generated.json';

const report = driftReport as DriftReport;

export function TokenDrift() {
  return (
    <Section
      id="token-drift"
      title="Token drift"
      description="Raw hex colors in the web app CSS modules that should use a design token. Fix gradually; new code must use tokens."
    >
      <div className={styles.driftTotals}>
        <div>
          <strong>{report.totals.hardcodedColors}</strong>
          <span>hardcoded colors</span>
        </div>
        <div>
          <strong>{report.totals.files}</strong>
          <span>files affected</span>
        </div>
        <div>
          <strong>{report.totals.tokenReferences}</strong>
          <span>token references</span>
        </div>
      </div>
      {report.files.length === 0 ? (
        <p className={styles.note}>No hardcoded colors found.</p>
      ) : (
        <div className={styles.driftList}>
          {report.files.map((entry) => (
            <details key={entry.file}>
              <summary>
                {entry.file} <span className={styles.note}>({entry.uses.length})</span>
              </summary>
              <ul>
                {entry.uses.map((use) => (
                  <li key={`${use.line}-${use.hex}`}>
                    line {use.line}{' '}
                    <span className={styles.driftSwatch} style={{ background: use.hex }} />{' '}
                    {use.hex} → {use.exact ? 'exact match' : 'nearest'}{' '}
                    <CopyChip value={use.nearestToken} />
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
      )}
      <h3 className={styles.subheading}>Declared but not in the token registry</h3>
      {report.undocumentedTokens.length === 0 ? (
        <p className={styles.note}>Every token in styles.css is registered.</p>
      ) : (
        <>
          <p className={styles.note}>
            These exist in styles.css but are missing from <code>designTokens</code>, so they have
            no description or deprecation path.
          </p>
          <div className={styles.inlineRow}>
            {report.undocumentedTokens.map((name) => (
              <CopyChip key={name} value={name} />
            ))}
          </div>
        </>
      )}
    </Section>
  );
}

export function DeprecatedTokens() {
  const deprecated = designTokens.filter((token) => token.status === 'deprecated');
  return (
    <Section
      id="deprecated"
      title="Deprecated tokens"
      description="Tokens being retired, with what to use instead."
    >
      {deprecated.length === 0 ? (
        <p className={styles.note}>No deprecated tokens right now.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Token</th>
              <th>Use instead</th>
              <th>Deprecated in</th>
              <th>Removed after</th>
            </tr>
          </thead>
          <tbody>
            {deprecated.map((token) => (
              <tr key={token.cssVariable}>
                <td>
                  <CopyChip value={token.cssVariable} />
                </td>
                <td>{token.replacement ? <CopyChip value={token.replacement} /> : '—'}</td>
                <td>{token.deprecatedIn ?? '—'}</td>
                <td>{token.removeAfter ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

const plannedSections = [
  { title: 'Notifications', body: 'In-app notification list, bell and banners.' },
  {
    title: 'Data display',
    body: 'Cards in context, tables, KPI tiles, calendar and photo gallery.',
  },
  {
    title: 'Dark theme',
    body: 'A dark token set and a theme switch; the app has no dark mode today.',
  },
  { title: 'Email templates', body: 'Branded email layouts from the Milestone 22 work.' },
] as const;

export function Planned() {
  const pendingComponents = Object.entries(styleguideCoverage).filter(
    ([, entry]) => entry.status === 'planned',
  );
  return (
    <Section id="planned" title="Planned" description="Not built on this page yet. Titles only.">
      <ul className={styles.plannedList}>
        {plannedSections.map((item) => (
          <li key={item.title}>
            <strong>{item.title}</strong>
            <span>{item.body}</span>
          </li>
        ))}
        {pendingComponents.map(([name, entry]) => (
          <li key={name}>
            <strong>{name}</strong>
            <span>{entry.status === 'planned' ? entry.reason : ''}</span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
