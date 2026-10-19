'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { Alert, AlertDescription } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { PasswordField } from '../../../components/ui/password-field';
import { ConsoleApiError, consoleRequest } from '../../../lib/platform-api';

/** A new team member sets a password from the one-time link and lands in the console. */
export default function AcceptInvitationPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setError('This invitation link is incomplete. Ask for a new one.');
      return;
    }
    if (password.length < 12 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setError('Choose a password of at least 12 characters with a letter and a digit.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await consoleRequest(
        'POST',
        '/auth/invitations/accept',
        { token, password, firstName, lastName },
        { idempotencyKey: null },
      );
      router.replace('/platform');
    } catch (caught) {
      setError(
        caught instanceof ConsoleApiError && caught.status === 400
          ? 'This invitation has expired or was already used. Ask for a new one.'
          : 'We could not accept the invitation. Nothing was changed.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Join the platform console</CardTitle>
          <p className="m-0 text-sm text-muted-foreground">Choose your name and a password.</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
            {error ? (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <FormField label="First name" htmlFor="invite-first">
                <Input
                  id="invite-first"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </FormField>
              <FormField label="Last name" htmlFor="invite-last">
                <Input
                  id="invite-last"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </FormField>
            </div>
            <FormField label="Password" htmlFor="invite-password" required>
              <PasswordField id="invite-password" value={password} onChange={setPassword} />
            </FormField>
            <Button type="submit" loading={busy}>
              Join
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
