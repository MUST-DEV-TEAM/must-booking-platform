import { AuthRouteGuard } from '../../auth-routing';
import { StyleGuide } from './styleguide';

export default function StyleGuidePage() {
  return (
    <AuthRouteGuard audience="platform">
      <StyleGuide />
    </AuthRouteGuard>
  );
}
