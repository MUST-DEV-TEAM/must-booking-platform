import { type ReactNode } from 'react';

import { DashboardQueryProvider } from './query-provider';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <DashboardQueryProvider>{children}</DashboardQueryProvider>;
}
