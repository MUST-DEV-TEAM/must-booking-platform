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
 */
export default function DesignLayout({ children }: { children: ReactNode }) {
  return (
    <AuthRouteGuard audience="platform">
      <DesignShell>{children}</DesignShell>
    </AuthRouteGuard>
  );
}
