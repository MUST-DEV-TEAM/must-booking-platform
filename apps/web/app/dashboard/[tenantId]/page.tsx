import { AuthRouteGuard } from '../../auth-routing';
import { DashboardShell } from '../dashboard-shell';

export default async function TenantDashboardPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  return (
    <AuthRouteGuard audience="tenant">
      <DashboardShell tenantId={tenantId} />
    </AuthRouteGuard>
  );
}
