import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';

/** A screen the signed-in role may not use. Says what is missing instead of showing a blank page. */
export function PermissionPanel({
  title = 'You don’t have access to this',
  description = 'Your platform role does not include this area. Ask a Super admin if you need it.',
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-10 text-center"
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-secondary text-primary">
        <Lock aria-hidden="true" className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="m-0 font-bold">{title}</p>
        <p className="m-0 max-w-[28rem] text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}
