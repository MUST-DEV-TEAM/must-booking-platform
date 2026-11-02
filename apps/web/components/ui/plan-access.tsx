'use client';

import { createContext, useContext } from 'react';

export const PLAN_LOCK_MESSAGE = 'Your plan is read-only. Upgrade your plan to use this.';

const PlanAccessContext = createContext({ readOnly: false });

/** Provided by the hotel dashboard; true on a read-only plan (Free), where writes are refused. */
export const PlanAccessProvider = PlanAccessContext.Provider;

export function usePlanAccess(): { readOnly: boolean } {
  return useContext(PlanAccessContext);
}
