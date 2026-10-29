'use client';
import { createContext, useContext, type ReactNode } from 'react';
type Scope = { tenantId: string; propertyId: string; currency?: string | null };
const HotelMoneyContext = createContext<Scope | null>(null);
/** Property currency scoped to the selected tenant and hotel, never global. */
export function HotelMoneyProvider({ children, ...scope }: Scope & { children: ReactNode }) {
  return <HotelMoneyContext.Provider value={scope}>{children}</HotelMoneyContext.Provider>;
}
export const useHotelMoneyScope = () => useContext(HotelMoneyContext);
