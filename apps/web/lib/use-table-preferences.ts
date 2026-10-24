'use client';

import { useCallback, useEffect, useState } from 'react';

export type Density = 'comfortable' | 'compact';

/**
 * Which columns a table shows and how tall its rows are, remembered in this browser under `key`.
 * Storage can be blocked or hold bad data, so the defaults always work.
 */
export function useTablePreferences<K extends string>(key: string, defaults: Record<K, boolean>) {
  const [columns, setColumns] = useState<Record<K, boolean>>(defaults);
  const [density, setDensity] = useState<Density>('comfortable');

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const saved = JSON.parse(raw) as { columns?: Partial<Record<K, boolean>>; density?: Density };
      if (saved.columns) setColumns({ ...defaults, ...saved.columns });
      if (saved.density === 'compact') setDensity('compact');
    } catch {
      // Fall back to the defaults.
    }
    // The defaults are a constant of the caller; only the key decides what to load.
  }, [key]);

  const save = useCallback(
    (nextColumns: Record<K, boolean>, nextDensity: Density) => {
      try {
        window.localStorage.setItem(
          key,
          JSON.stringify({ columns: nextColumns, density: nextDensity }),
        );
      } catch {
        // Remembering the choice is a convenience.
      }
    },
    [key],
  );

  const toggleColumn = (column: K) => {
    const next = { ...columns, [column]: !columns[column] };
    setColumns(next);
    save(next, density);
  };
  const toggleDensity = () => {
    const next: Density = density === 'compact' ? 'comfortable' : 'compact';
    setDensity(next);
    save(columns, next);
  };

  return { columns, density, toggleColumn, toggleDensity };
}
