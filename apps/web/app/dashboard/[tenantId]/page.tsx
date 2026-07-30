import { DashboardShell } from '../dashboard-shell';
import { PropertyManagement } from './property-management';
import { RateManagement } from './rate-management';
import { RoomManagement } from './room-management';
export default async function TenantDashboardPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  return (
    <>
      <DashboardShell />
      <PropertyManagement tenantId={tenantId} />
      <RoomManagement tenantId={tenantId} />
      <RateManagement tenantId={tenantId} />
    </>
  );
}
