import { AuthRouteGuard } from '../auth-routing';
import { TenantPicker } from './tenant-picker';

export default function DashboardPage() {
  return (
    <AuthRouteGuard audience="tenant">
      <TenantPicker />
    </AuthRouteGuard>
  );
}
