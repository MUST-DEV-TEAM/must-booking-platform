import { HomeAuthRedirect } from './auth-routing';
import { SignupForm } from './signup-form';

export default function Home() {
  return (
    <HomeAuthRedirect>
      <SignupForm />
    </HomeAuthRedirect>
  );
}
