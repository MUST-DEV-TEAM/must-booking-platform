'use client';

import type { SettingsArea } from './settings-areas';
import { resolveSettingsTab, settingsTabHref, type SettingsTab } from './settings-registry';

/** A link to a Settings tab; old area names (`general`, `payments`…) land on their new tab. */
export function settingsAreaHref(
  tenantId: string,
  propertyId: string,
  area?: SettingsArea | SettingsTab,
) {
  return settingsTabHref(tenantId, propertyId, resolveSettingsTab(area));
}
