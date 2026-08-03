import { AuthRouteGuard } from '../../auth-routing';
import { PropertyEntry } from '../property-entry';

export default async function TenantDashboardPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  return (
    <AuthRouteGuard audience="tenant">
      <PropertyEntry tenantId={tenantId} />
    </AuthRouteGuard>
  );
}
