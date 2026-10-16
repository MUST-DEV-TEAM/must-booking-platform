import { type ReactNode } from 'react';

import { DashboardQueryProvider } from './query-provider';
import './dashboard.css';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardQueryProvider>
      <div className="ui-root">{children}</div>
    </DashboardQueryProvider>
  );
}
