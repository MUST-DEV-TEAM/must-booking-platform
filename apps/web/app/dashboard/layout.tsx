import { type ReactNode } from 'react';

import { DashboardQueryProvider } from './query-provider';
import { SupportBar } from './support-bar';
import './dashboard.css';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <DashboardQueryProvider>
      <div className="ui-root">
        <SupportBar />
        {children}
      </div>
    </DashboardQueryProvider>
  );
}
