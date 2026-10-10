import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AuthRouteGuard } from '../auth-routing';
import { DesignShell } from './design-shell';
import './design.css';

export const metadata: Metadata = {
  title: 'MUST Design preview',
  robots: { index: false, follow: false },
};

/**
 * /design is a platform-owner-only preview of the new UI: a component showcase and demo pages
 * with fake data. Nothing here is linked from the live dashboard or reads real data.
 *
 * Under `next dev` the login check is skipped so the pages open with only the web app running.
 * `NODE_ENV` is `production` in every build and deploy, so the skip can never apply there.
 */
export default function DesignLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'development') {
    return <DesignShell>{children}</DesignShell>;
  }
  return (
    <AuthRouteGuard audience="platform">
      <DesignShell>{children}</DesignShell>
    </AuthRouteGuard>
  );
}
