'use client';

import { useLayoutEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';

import styles from './styleguide.module.css';

/**
 * Forced pseudo-states. A real `:hover` or `:focus-visible` cannot be switched on from markup,
 * so every rule that uses one is cloned once with the pseudo-class swapped for a plain class
 * (`.sg-hover`, `.sg-focus`, `.sg-active`). A specimen then just adds that class. The cloned
 * rules are generated from the live stylesheets, so they can never drift from the components.
 */
const FORCED_STYLE_ID = 'sg-forced-pseudo-states';
const PSEUDO_PATTERN = /:(hover|focus-visible|focus-within|focus|active)\b/;

export type ForcedState = 'hover' | 'focus' | 'active';
export const forcedClass: Record<ForcedState, string> = {
  hover: 'sg-hover',
  focus: 'sg-focus',
  active: 'sg-active',
};

function splitTopLevel(selectorList: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < selectorList.length; index += 1) {
    const char = selectorList[index];
    if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(selectorList.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(selectorList.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function forceSelector(selector: string): string {
  return selector
    .replace(/:hover\b/g, `.${forcedClass.hover}`)
    .replace(/:focus-visible\b/g, `.${forcedClass.focus}`)
    .replace(/:focus-within\b/g, `.${forcedClass.focus}`)
    .replace(/:focus\b/g, `.${forcedClass.focus}`)
    .replace(/:active\b/g, `.${forcedClass.active}`);
}

function collectForcedRules(rules: CSSRuleList, output: string[]) {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      // Only the selectors that actually use a pseudo-class are cloned; the rest of a
      // comma-separated list must not leak its styles onto resting elements.
      const forced = splitTopLevel(rule.selectorText)
        .filter((selector) => PSEUDO_PATTERN.test(selector))
        .map(forceSelector);
      if (forced.length) output.push(`${forced.join(', ')} { ${rule.style.cssText} }`);
    } else if (rule instanceof CSSMediaRule) {
      const inner: string[] = [];
      collectForcedRules(rule.cssRules, inner);
      if (inner.length) output.push(`@media ${rule.media.mediaText} { ${inner.join('\n')} }`);
    } else if (rule instanceof CSSSupportsRule) {
      const inner: string[] = [];
      collectForcedRules(rule.cssRules, inner);
      if (inner.length) output.push(`@supports ${rule.conditionText} { ${inner.join('\n')} }`);
    }
  }
}

export function injectForcedStateStyles() {
  if (typeof document === 'undefined' || document.getElementById(FORCED_STYLE_ID)) return;
  const output: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      collectForcedRules(sheet.cssRules, output);
    } catch {
      // Cross-origin sheets (e.g. font CSS) cannot be read and never style our components.
    }
  }
  const element = document.createElement('style');
  element.id = FORCED_STYLE_ID;
  element.textContent = output.join('\n');
  document.head.appendChild(element);
}

export function useForcedPseudoStates() {
  useLayoutEffect(() => {
    injectForcedStateStyles();
  }, []);
}

/** Reads the resolved value of CSS custom properties from the page, so nothing is retyped here. */
export function useTokenValues(names: readonly string[]): Record<string, string> {
  const [values, setValues] = useState<Record<string, string>>({});
  const key = names.join('|');
  useLayoutEffect(() => {
    const computed = getComputedStyle(document.documentElement);
    setValues(
      Object.fromEntries(names.map((name) => [name, computed.getPropertyValue(name).trim()])),
    );
    // `key` stands in for the (stable) names list.
  }, [key]);
  return values;
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`Copied ${text}`);
  } catch {
    toast.error('Copy is not available in this browser.');
  }
}

/** A click-to-copy chip for a token or class name. */
export function CopyChip({ value, label }: { value: string; label?: string }) {
  return (
    <button
      className={styles.copyChip}
      type="button"
      onClick={() => void copyText(value)}
      title="Click to copy"
    >
      {label ?? value}
    </button>
  );
}

export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section} id={id} aria-labelledby={`${id}-title`}>
      <header className={styles.sectionHeader}>
        <h2 id={`${id}-title`}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>
      {children}
    </section>
  );
}

export function Specimen({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.specimen}>
      <h3>{title}</h3>
      {note ? <p className={styles.note}>{note}</p> : null}
      {children}
    </div>
  );
}

export type StateColumn = {
  label: string;
  forced?: ForcedState;
  disabled?: boolean;
};

/** Every state of one component side by side: a column per state, rendered by `render`. */
export function StateGrid({
  columns,
  render,
}: {
  columns: readonly StateColumn[];
  render: (state: StateColumn, className: string | undefined) => ReactNode;
}) {
  return (
    <div className={styles.stateGrid}>
      {columns.map((column) => (
        <div className={styles.stateCell} key={column.label}>
          <span className={styles.stateLabel}>{column.label}</span>
          {render(column, column.forced ? forcedClass[column.forced] : undefined)}
        </div>
      ))}
    </div>
  );
}

export const interactiveStates: readonly StateColumn[] = [
  { label: 'Default' },
  { label: 'Hover', forced: 'hover' },
  { label: 'Focus', forced: 'focus' },
  { label: 'Active', forced: 'active' },
  { label: 'Disabled', disabled: true },
];
