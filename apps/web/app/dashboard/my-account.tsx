'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { Alert, AlertDescription } from '../../components/ui/alert';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { DetailList } from '../../components/ui/detail-list';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHero } from '../../components/ui/page-hero';
import { PhoneInput, parsePhone, type PhoneValue } from '../../components/ui/phone-input';
import { findDialCountry } from '../../lib/dial-codes';
import { Combobox } from '../../components/ui/combobox';
import { timeZoneOptions } from './settings-areas';
import { PasswordField } from '../../components/ui/password-field';
import { SettingToggle } from '../../components/ui/setting-toggle';
import { ErrorPanel, ListSkeleton } from '../../components/ui/state-panel';

type Profile = {
  birthDate?: string | null;
  phoneCountryCode?: string | null;
  phoneNumber?: string | null;
  jobTitle?: string | null;
  preferredLanguage?: string | null;
  personalTimezone?: string | null;
  preferredDateTimeFormat?: string | null;
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
  hotelTimezone = 'UTC',
  tenantId,
}: {
  email?: string;
  role?: string;
  hotelName?: string;
  hotelTimezone?: string;
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
  const dirty = useRef(false);
  const [details, setDetails] = useState({
    birthDate: '',
    jobTitle: '',
    preferredLanguage: '',
    personalTimezone: '',
    preferredDateTimeFormat: 'DD/MM/YYYY',
  });
  const [birthday, setBirthday] = useState('');
  const [birthdayTouched, setBirthdayTouched] = useState(false);
  const [phone, setPhone] = useState<PhoneValue>({ iso: 'AL', number: '' });
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  useEffect(() => {
    if (profile.data && !dirty.current) {
      setDetails({
        birthDate: profile.data.birthDate ?? '',
        jobTitle: profile.data.jobTitle ?? '',
        preferredLanguage: profile.data.preferredLanguage ?? '',
        personalTimezone: profile.data.personalTimezone ?? '',
        preferredDateTimeFormat: profile.data.preferredDateTimeFormat ?? 'DD/MM/YYYY',
      });
      setBirthday(
        formatAccountDate(
          profile.data.birthDate ?? '',
          profile.data.preferredDateTimeFormat ?? 'DD/MM/YYYY',
        ),
      );
      setPhone(
        parsePhone((profile.data.phoneCountryCode ?? '') + ' ' + (profile.data.phoneNumber ?? '')),
      );
      setFirstName(profile.data.firstName ?? '');
      setLastName(profile.data.lastName ?? '');
    }
  }, [profile.data]);

  const saveProfile = useMutation({
    mutationFn: () =>
      accountRequest('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          firstName,
          lastName,
          ...details,
          phoneCountryCode: phone.number ? findDialCountry(phone.iso)?.prefix : null,
          phoneNumber: phone.number || null,
        }),
      }),
    onSuccess: () => {
      dirty.current = false;
      return client.invalidateQueries({ queryKey: ['my-account', 'profile'] });
    },
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
    lastName.trim() !== (profile.data.lastName ?? '') ||
    Object.entries(details).some(
      ([key, value]) =>
        value !==
        (profile.data[key as keyof Profile] ??
          (key === 'preferredDateTimeFormat' ? 'DD/MM/YYYY' : '')),
    ) ||
    phone.number !== (profile.data.phoneNumber ?? '') ||
    (!!phone.number && findDialCountry(phone.iso)?.prefix !== profile.data.phoneCountryCode);
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
              <FormField className="gap-2" label="First name" htmlFor="account-first-name">
                <Input
                  id="account-first-name"
                  value={firstName}
                  maxLength={100}
                  onChange={(event) => {
                    dirty.current = true;
                    setFirstName(event.target.value);
                  }}
                />
              </FormField>
              <FormField className="gap-2" label="Last name" htmlFor="account-last-name">
                <Input
                  id="account-last-name"
                  value={lastName}
                  maxLength={100}
                  onChange={(event) => {
                    dirty.current = true;
                    setLastName(event.target.value);
                  }}
                />
              </FormField>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField className="gap-2" label="Phone (optional)" htmlFor="account-phone">
                <PhoneInput
                  id="account-phone"
                  value={phone}
                  onChange={(value) => {
                    dirty.current = true;
                    setPhone(value);
                  }}
                />
              </FormField>
              <FormField className="gap-2" label="Birthday (optional)" htmlFor="account-birthday">
                <Input
                  id="account-birthday"
                  inputMode="numeric"
                  placeholder={details.preferredDateTimeFormat}
                  value={birthday}
                  aria-invalid={
                    birthdayTouched &&
                    !!birthday &&
                    !parseAccountDate(birthday, details.preferredDateTimeFormat)
                  }
                  onBlur={() => setBirthdayTouched(true)}
                  onChange={(e) => {
                    dirty.current = true;
                    setBirthday(e.target.value);
                    const iso = parseAccountDate(e.target.value, details.preferredDateTimeFormat);
                    if (iso !== null) setDetails({ ...details, birthDate: iso });
                  }}
                />
                {birthdayTouched &&
                birthday &&
                !parseAccountDate(birthday, details.preferredDateTimeFormat) ? (
                  <p className="text-xs text-destructive">
                    Enter a valid date as {details.preferredDateTimeFormat}.
                  </p>
                ) : null}
              </FormField>
              <FormField className="gap-2" label="Job title (optional)" htmlFor="account-job-title">
                <Input
                  id="account-job-title"
                  maxLength={100}
                  value={details.jobTitle}
                  onChange={(e) => {
                    dirty.current = true;
                    setDetails({ ...details, jobTitle: e.target.value });
                  }}
                />
              </FormField>
              <FormField className="gap-2" label="Preferred language">
                <Combobox
                  label="Preferred language"
                  value={details.preferredLanguage}
                  options={[
                    { value: '', label: 'Not set' },
                    { value: 'en', label: 'English' },
                    { value: 'sq', label: 'Albanian' },
                  ]}
                  onChange={(v) => {
                    dirty.current = true;
                    setDetails({ ...details, preferredLanguage: v });
                  }}
                />
              </FormField>
              <FormField className="gap-2" label="Date format">
                <Combobox
                  label="Date format"
                  value={details.preferredDateTimeFormat}
                  options={['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map((value) => ({
                    value,
                    label: value,
                  }))}
                  onChange={(value) => {
                    dirty.current = true;
                    setDetails({ ...details, preferredDateTimeFormat: value });
                    setBirthday(formatAccountDate(details.birthDate, value));
                  }}
                />
              </FormField>
              <FormField className="gap-2" label="Personal timezone">
                <Combobox
                  label="Personal timezone"
                  value={details.personalTimezone}
                  options={[
                    { value: '', label: `Use hotel timezone (${hotelTimezone})` },
                    ...timeZoneOptions(details.personalTimezone).map((v) => ({
                      value: v,
                      label: v,
                    })),
                  ]}
                  onChange={(v) => {
                    dirty.current = true;
                    setDetails({ ...details, personalTimezone: v });
                  }}
                />
              </FormField>
            </div>
            <p className="text-sm text-muted-foreground">
              Additional details are optional and belong to your account, separate from hotel guest
              records. Language and timezone are saved preferences; they do not change hotel
              operating rules.
            </p>
            {saveProfile.error ? (
              <Alert variant="destructive">
                <AlertDescription>{saveProfile.error.message}</AlertDescription>
              </Alert>
            ) : null}
            {saveProfile.isSuccess && !nameChanged ? (
              <p role="status" className="m-0 text-sm text-muted-foreground">
                Profile saved.
              </p>
            ) : null}
            <div>
              <Button
                disabled={
                  !nameChanged ||
                  saveProfile.isPending ||
                  (!!birthday && !parseAccountDate(birthday, details.preferredDateTimeFormat))
                }
                onClick={() => saveProfile.mutate()}
              >
                Save profile
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Password</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <FormField
              className="gap-2"
              label="Current password"
              htmlFor="account-current-password"
            >
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
            <FormField
              className="gap-2"
              label="Repeat new password"
              htmlFor="account-confirm-password"
            >
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

export function formatAccountDate(iso: string, format: string) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return format === 'MM/DD/YYYY'
    ? `${m}/${d}/${y}`
    : format === 'YYYY-MM-DD'
      ? iso
      : `${d}/${m}/${y}`;
}
export function parseAccountDate(text: string, format: string): string | null {
  if (!text.trim()) return '';
  const pattern =
    format === 'YYYY-MM-DD' ? /^(\d{4})-(\d{2})-(\d{2})$/ : /^(\d{2})\/(\d{2})\/(\d{4})$/;
  const match = pattern.exec(text);
  if (!match) return null;
  const iso =
    format === 'YYYY-MM-DD'
      ? text
      : format === 'MM/DD/YYYY'
        ? `${match[3]}-${match[1]}-${match[2]}`
        : `${match[3]}-${match[2]}-${match[1]}`;
  const date = new Date(iso + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === iso &&
    iso <= new Date().toISOString().slice(0, 10)
    ? iso
    : null;
}
