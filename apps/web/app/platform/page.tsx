import { AppShell, Heading, Text } from '@must/ui';

import { AuthRouteGuard } from '../auth-routing';

const platformNavigation = [{ href: '/platform', label: 'Overview', current: true }] as const;

export default function PlatformPage() {
  return (
    <AuthRouteGuard audience="platform">
      <AppShell navigation={platformNavigation} title="Platform operations">
        <Heading>Platform operations</Heading>
        <Text tone="secondary">
          The MUST platform-admin workspace is ready for its Milestone 8 dashboard implementation.
        </Text>
      </AppShell>
    </AuthRouteGuard>
  );
}
