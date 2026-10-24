'use client';
import { createContext, useContext, type ReactNode } from 'react';
const Context = createContext('DD/MM/YYYY');
export function HotelDateFormatProvider({
  value,
  children,
}: {
  value?: string;
  children: ReactNode;
}) {
  return <Context.Provider value={value || 'DD/MM/YYYY'}>{children}</Context.Provider>;
}
export function useHotelDateFormat() {
  return useContext(Context);
}
export function formatHotelDate(day: string, format: string) {
  return format === 'YYYY-MM-DD'
    ? day
    : format === 'MM/DD/YYYY'
      ? `${day.slice(5, 7)}/${day.slice(8, 10)}/${day.slice(0, 4)}`
      : `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}
