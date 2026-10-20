'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { DetailList } from '../../components/ui/detail-list';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHero } from '../../components/ui/page-hero';
import { PasswordField } from '../../components/ui/password-field';
import { SettingToggle } from '../../components/ui/setting-toggle';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';

type Profile = {
  email: string;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
};
type Preferences = { muteOptionalEmails: boolean };

async function accountRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
    throw new Error(typeof body?.message === 'string' ? body.message : 'Something went wrong.');
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/**
 * The signed-in user's own page (opened from the account menu, "Profile"): name, password and
 * their personal email preference. Active-session management is not available yet (gap).
 */
export function MyAccount({
  email,
  role,
  hotelName,
  tenantId,
}: {
  email?: string;
  role?: string;
  hotelName?: string;
  tenantId?: string;
}) {
  const client = useQueryClient();
  const profile = useQuery({
    queryKey: ['my-account', 'profile'],
    queryFn: () => accountRequest<Profile>('/api/auth/profile'),
  });
  const preferences = useQuery({
    queryKey: ['my-account', 'preferences', tenantId],
    queryFn: () => accountRequest<Preferences>(`/api/tenants/${tenantId}/my-email-preferences`),
    enabled: !!tenantId,
  });
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  useEffect(() => {
    if (profile.data) {
      setFirstName(profile.data.firstName ?? '');
      setLastName(profile.data.lastName ?? '');
    }
  }, [profile.data]);

  const saveProfile = useMutation({
    mutationFn: () =>
      accountRequest('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ firstName, lastName }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['my-account', 'profile'] }),
  });
  const verify = useMutation({
    mutationFn: () =>
      accountRequest('/api/auth/email-verification/request', {
        method: 'POST',
        body: JSON.stringify({ email: profile.data?.email ?? email }),
      }),
  });
  const mute = useMutation({
    mutationFn: (value: boolean) =>
      accountRequest<Preferences>(`/api/tenants/${tenantId}/my-email-preferences`, {
        method: 'PUT',
        body: JSON.stringify({ muteOptionalEmails: value }),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['my-account', 'preferences'] }),
  });

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const changePassword = useMutation({
    mutationFn: () =>
      accountRequest('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      }),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirm('');
      setPasswordError(null);
    },
  });
  const submitPassword = () => {
    changePassword.reset();
    if (!current) return setPasswordError('Enter your current password.');
    if (next.length < 12) return setPasswordError('Use at least 12 characters.');
    if (next !== confirm) return setPasswordError('The two new passwords do not match.');
    setPasswordError(null);
    changePassword.mutate();
  };

  if (profile.isPending)
    return (
      <div className="space-y-4">
        <PageHero eyebrow="Account" title="My account" />
        <ListSkeleton rows={3} />
      </div>
    );
  if (profile.error)
    return (
      <div className="space-y-4">
        <PageHero eyebrow="Account" title="My account" />
        <ErrorPanel
          title="Your account could not be loaded"
          description={profile.error.message}
          onRetry={() => void profile.refetch()}
        />
      </div>
    );

  const nameChanged =
    firstName.trim() !== (profile.data.firstName ?? '') ||
    lastName.trim() !== (profile.data.lastName ?? '');
  return (
    <div className="space-y-4">
      <PageHero
        eyebrow="Account"
        title="My account"
        description="Your sign-in details and personal preferences."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Profile</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <DetailList
              items={[
                { label: 'Email', value: profile.data.email ?? email },
                { label: 'Role', value: role },
                { label: 'Current hotel', value: hotelName },
              ]}
            />
            <div className="flex items-center gap-2">
              <Badge variant={profile.data.emailVerified ? 'success' : 'warning'}>
                {profile.data.emailVerified ? 'Email verified' : 'Email not verified'}
              </Badge>
              {!profile.data.emailVerified ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={verify.isPending || verify.isSuccess}
                  onClick={() => verify.mutate()}
                >
                  {verify.isSuccess ? 'Verification email sent' : 'Send verification email'}
                </Button>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="First name" htmlFor="account-first-name">
                <Input
                  id="account-first-name"
                  value={firstName}
                  maxLength={100}
                  onChange={(event) => setFirstName(event.target.value)}
                />
              </FormField>
              <FormField label="Last name" htmlFor="account-last-name">
                <Input
                  id="account-last-name"
                  value={lastName}
                  maxLength={100}
                  onChange={(event) => setLastName(event.target.value)}
                />
              </FormField>
            </div>
            {saveProfile.error ? (
              <Alert variant="destructive">
                <AlertDescription>{saveProfile.error.message}</AlertDescription>
              </Alert>
            ) : null}
            {saveProfile.isSuccess && !nameChanged ? (
              <p role="status" className="m-0 text-sm text-muted-foreground">
                Name saved.
              </p>
            ) : null}
            <div>
              <Button
                disabled={!nameChanged || saveProfile.isPending}
                onClick={() => saveProfile.mutate()}
              >
                Save name
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Password</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FormField label="Current password" htmlFor="account-current-password">
              <Input
                id="account-current-password"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
              />
            </FormField>
            <FormField
              label="New password"
              htmlFor="account-new-password"
              hint="At least 12 characters."
            >
              <PasswordField id="account-new-password" value={next} onChange={setNext} />
            </FormField>
            <FormField label="Repeat new password" htmlFor="account-confirm-password">
              <Input
                id="account-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </FormField>
            {passwordError || changePassword.error ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {passwordError ?? changePassword.error?.message}
                </AlertDescription>
              </Alert>
            ) : null}
            {changePassword.isSuccess ? (
              <Alert>
                <AlertDescription>Your password was changed.</AlertDescription>
              </Alert>
            ) : null}
            <div>
              <Button disabled={changePassword.isPending} onClick={submitPassword}>
                Change password
              </Button>
            </div>
          </CardContent>
        </Card>
        {tenantId ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Email preferences</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {preferences.error ? (
                <Alert variant="destructive">
                  <AlertDescription>Your email preference could not be loaded.</AlertDescription>
                </Alert>
              ) : (
                <SettingToggle
                  label="Mute non-urgent staff emails (daily summary, refund notices)"
                  checked={preferences.data?.muteOptionalEmails ?? false}
                  disabled={!preferences.data || mute.isPending}
                  onChange={(value) => mute.mutate(value)}
                />
              )}
              <p className="m-0 text-sm text-muted-foreground">
                New bookings, cancellations and problem alerts cannot be muted.
              </p>
              {mute.error ? (
                <Alert variant="destructive">
                  <AlertDescription>{mute.error.message}</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
