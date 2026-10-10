'use client';

import { Palette } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

export const designThemes = [
  { id: 'neutral', label: 'Neutral (default)', swatch: '#18181b' },
  { id: 'pine', label: 'Pine green', swatch: '#1f4b3f' },
  { id: 'ocean', label: 'Ocean blue', swatch: '#1d4ed8' },
  { id: 'terracotta', label: 'Terracotta', swatch: '#9a3412' },
] as const;

export type DesignThemeId = (typeof designThemes)[number]['id'];

const storageKey = 'must-design-theme';

function readStoredTheme(): DesignThemeId {
  try {
    const stored = window.localStorage.getItem(storageKey);
    if (designThemes.some((theme) => theme.id === stored)) return stored as DesignThemeId;
  } catch {
    // storage can be blocked; fall back to the default
  }
  return 'neutral';
}

/** Preview of the in-app theme picker. A client theme is one more token block in design.css. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const [theme, setTheme] = useState<DesignThemeId>('neutral');

  useEffect(() => {
    setTheme(readStoredTheme());
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  function choose(next: string) {
    setTheme(next as DesignThemeId);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // not persisted; the choice still applies for this visit
    }
  }

  return (
    <Select value={theme} onValueChange={choose}>
      <SelectTrigger aria-label="Theme" className={className}>
        <Palette className="size-4" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {designThemes.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            <span
              aria-hidden="true"
              className="mr-1 inline-block size-3 rounded-full border"
              style={{ background: item.swatch }}
            />
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
