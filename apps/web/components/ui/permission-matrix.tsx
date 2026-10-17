'use client';

import { Checkbox } from './checkbox';

export type PermissionCatalogItem = {
  group: string;
  key: string;
  label: string;
  description: string;
};

/** Renders catalog permissions by area with checkboxes and optional locked-state reasons. */
export function PermissionMatrix({
  catalog,
  selectedKeys,
  onChange,
  readOnly = false,
  disabledReasons = {},
  annotations = {},
  ariaLabel = 'Permissions',
}: {
  catalog: readonly PermissionCatalogItem[];
  selectedKeys: readonly string[];
  onChange: (keys: string[]) => void;
  readOnly?: boolean;
  disabledReasons?: Readonly<Record<string, string>>;
  annotations?: Readonly<Record<string, string>>;
  ariaLabel?: string;
}) {
  const groups = new Map<string, PermissionCatalogItem[]>();
  for (const permission of catalog) {
    const items = groups.get(permission.group) ?? [];
    items.push(permission);
    groups.set(permission.group, items);
  }
  const selected = new Set(selectedKeys);

  return (
    <div aria-label={ariaLabel} className="divide-y rounded-lg border">
      {[...groups.entries()].map(([group, permissions]) => (
        <section key={group} aria-label={group} className="space-y-2 p-3">
          <h3 className="m-0 text-sm font-semibold">{group}</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {permissions.map((permission) => {
              const reason = disabledReasons[permission.key];
              const annotation = annotations[permission.key];
              const id = `${ariaLabel}-${permission.key}`;
              return (
                <div key={permission.key} className="min-w-0 rounded-md border p-3">
                  <label htmlFor={id} className="flex cursor-pointer items-start gap-2">
                    <Checkbox
                      id={id}
                      aria-label={permission.label}
                      aria-describedby={reason ? `${id}-reason` : undefined}
                      checked={selected.has(permission.key)}
                      disabled={readOnly || !!reason}
                      onCheckedChange={(checked) => {
                        const next = new Set(selected);
                        if (checked === true) next.add(permission.key);
                        else next.delete(permission.key);
                        onChange([...next]);
                      }}
                    />
                    <span className="min-w-0 space-y-1">
                      <span className="block text-sm font-medium">{permission.label}</span>
                      <code className="block break-all text-[10px] text-muted-foreground">
                        {permission.key}
                      </code>
                    </span>
                  </label>
                  {permission.description ? (
                    <p className="m-0 mt-2 text-xs text-muted-foreground">
                      {permission.description}
                    </p>
                  ) : null}
                  {annotation ? (
                    <p className="m-0 mt-2 text-xs font-semibold text-muted-foreground">
                      {annotation}
                    </p>
                  ) : null}
                  {reason ? (
                    <p id={`${id}-reason`} className="m-0 mt-2 text-xs text-warning">
                      {reason}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
