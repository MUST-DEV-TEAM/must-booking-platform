import { type ReactNode } from 'react';

import { PlatformProviders } from './platform-providers';
import './platform.css';

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <PlatformProviders>
      <div className="ui-root">{children}</div>
    </PlatformProviders>
  );
}
