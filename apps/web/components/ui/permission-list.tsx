'use client';

import { Badge } from './badge';

export type PermissionCatalogItem = {
  group: string;
  key: string;
  label: string;
  description: string;
};

export type PermissionSource = 'Role' | 'Extra' | 'Denied';

export type EffectivePermissionItem = PermissionCatalogItem & {
  source: PermissionSource;
};

export type EffectivePermissionState = {
  key: string;
  granted: boolean;
  source: 'role' | 'extra' | 'denied' | 'none';
};

/** A compact, grouped read-only summary for permissions and their source. */
export function PermissionList({
  permissions,
  ariaLabel = 'Permissions',
  emptyText = 'No permissions to show.',
}: {
  permissions: readonly EffectivePermissionItem[];
  ariaLabel?: string;
  emptyText?: string;
}) {
  const groups = new Map<string, EffectivePermissionItem[]>();
  for (const permission of permissions) {
    const items = groups.get(permission.group) ?? [];
    items.push(permission);
    groups.set(permission.group, items);
  }

  if (permissions.length === 0) {
    return <p className="m-0 text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div aria-label={ariaLabel} className="divide-y rounded-lg border">
      {[...groups.entries()].map(([group, items]) => (
        <section key={group} aria-label={group} className="space-y-1.5 p-2.5">
          <h3 className="m-0 text-xs font-semibold text-muted-foreground">{group}</h3>
          <ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-2">
            {items.map((permission) => (
              <li key={permission.key}>
                <div className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted/30 px-2 py-1.5 text-sm">
                  <span className="min-w-0 truncate" title={permission.description}>
                    {permission.label}
                  </span>
                  <Badge
                    variant={permission.source === 'Denied' ? 'danger' : 'secondary'}
                    className="text-[10px]"
                  >
                    {permission.source}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Keeps the catalog's display order and marks grants that the signed-in person cannot hold. */
export function permissionMultiSelectOptions(
  catalog: readonly PermissionCatalogItem[],
  heldCapabilities: readonly string[],
) {
  const held = new Set(heldCapabilities);
  return catalog.map((permission) => {
    const disabled = !held.has(permission.key);
    return {
      value: permission.key,
      label: permission.label,
      description: permission.description,
      group: permission.group,
      disabledReason: disabled ? 'You do not hold this permission' : undefined,
    };
  });
}

/** Converts effective capability records into only granted or explicitly denied entries. */
export function effectivePermissionItems(
  catalog: readonly PermissionCatalogItem[],
  effective: readonly EffectivePermissionState[],
): EffectivePermissionItem[] {
  const states = new Map(effective.map((permission) => [permission.key, permission]));
  return catalog.flatMap((permission) => {
    const state = states.get(permission.key);
    if (!state || (!state.granted && state.source !== 'denied')) return [];
    const source =
      state.source === 'role'
        ? 'Role'
        : state.source === 'extra'
          ? 'Extra'
          : state.source === 'denied'
            ? 'Denied'
            : null;
    return source ? [{ ...permission, source }] : [];
  });
}
