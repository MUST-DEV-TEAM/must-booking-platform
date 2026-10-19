'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { FormField } from '../../../components/ui/form-field';
import { IconButton } from '../../../components/ui/icon-button';
import { Input } from '../../../components/ui/input';
import { ConsoleApiError, consoleRequest } from '../../../lib/platform-api';

function safeReturnTo(value: string | null): string {
  return value && value.startsWith('/platform') && !value.startsWith('//') ? value : '/platform';
}

/** Sign-in for MUST Group staff. Separate from the hotel sign-in; hotel accounts do not work here. */
export default function PlatformLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; throttled: boolean } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError({ message: 'Enter your email and password.', throttled: false });
      return;
    }
    setBusy(true);
    try {
      await consoleRequest(
        'POST',
        '/auth/login',
        { email: email.trim(), password },
        { idempotencyKey: null },
      );
      const returnTo = new URLSearchParams(window.location.search).get('returnTo');
      router.replace(safeReturnTo(returnTo));
    } catch (caught) {
      const status = caught instanceof ConsoleApiError ? caught.status : 0;
      setError({
        message:
          status === 429
            ? 'Too many sign-in attempts. Try again in a few minutes.'
            : status === 401
              ? 'Incorrect email or password.'
              : 'We could not sign you in. Nothing was changed. Try again.',
        throttled: status === 429,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-xs font-extrabold text-primary-foreground">
              M
            </span>
            <span className="text-sm font-extrabold">MUST Group</span>
          </div>
          <CardTitle className="text-xl">Platform console</CardTitle>
          <p className="m-0 text-sm text-muted-foreground">
            For MUST Group staff. Hotel staff sign in to the hotel dashboard instead.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>{error.throttled ? 'Please wait' : 'Could not sign in'}</AlertTitle>
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            ) : null}
            <FormField label="Email" htmlFor="console-email">
              <Input
                id="console-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </FormField>
            <FormField label="Password" htmlFor="console-password">
              <div className="relative">
                <Input
                  id="console-password"
                  type={show ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="pr-10"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <IconButton
                  label={show ? 'Hide password' : 'Show password'}
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-1/2 right-1 -translate-y-1/2"
                  onClick={() => setShow((value) => !value)}
                >
                  {show ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </IconButton>
              </div>
            </FormField>
            <Button type="submit" loading={busy}>
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
