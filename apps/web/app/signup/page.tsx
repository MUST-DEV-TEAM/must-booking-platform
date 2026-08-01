import { HomeAuthRedirect } from '../auth-routing';
import { SignupForm } from '../signup-form';

export default function SignupPage() {
  return (
    <HomeAuthRedirect>
      <SignupForm />
    </HomeAuthRedirect>
  );
}
