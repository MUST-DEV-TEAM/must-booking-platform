'use client';

import { type FormEvent, useEffect, useState } from 'react';

import { Alert, Badge, Button, Card, Heading, Text, TextInput } from '@must/ui';

import { authAssets, AuthShell } from '../auth-shell';
import styles from './staff-invitation.module.css';

type InvitationState = 'loading' | 'activate' | 'accept' | 'success' | 'invalid';
type SuccessMode = 'activated' | 'accepted';

function responseMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object' || !('message' in body)) return fallback;
  const message = (body as { message?: unknown }).message;
  if (Array.isArray(message))
    return message.filter((value): value is string => typeof value === 'string').join(' ');
  return typeof message === 'string' ? message : fallback;
}

function isUnavailableMessage(message: string): boolean {
  return /invalid|expired|already used|unavailable/i.test(message);
}

export default function StaffInvitationPage() {
  const [state, setState] = useState<InvitationState>('loading');
  const [token, setToken] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [successMode, setSuccessMode] = useState<SuccessMode>('activated');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const suppliedToken = new URLSearchParams(window.location.search).get('token');
    setToken(suppliedToken);
    if (!suppliedToken) {
      setState('invalid');
      return () => {
        cancelled = true;
      };
    }

    void fetch('/api/auth/session', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return null;
        return (await response.json()) as { user?: { email?: string } };
      })
      .then((body) => {
        if (cancelled) return;
        const signedInEmail = body?.user?.email;
        if (signedInEmail) {
          setSessionEmail(signedInEmail);
          setState('accept');
        } else {
          setState('activate');
        }
      })
      .catch(() => {
        if (!cancelled) setState('activate');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!token) {
      setState('invalid');
      return;
    }
    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    if (password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/staff-invitations/activate', {
        body: JSON.stringify({ email, password, token }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) {
        const message = responseMessage(
          await response.json().catch(() => null),
          'We could not activate this invitation. Please try again.',
        );
        if (isUnavailableMessage(message)) {
          setState('invalid');
          return;
        }
        throw new Error(message);
      }
      setSuccessMode('activated');
      setState('success');
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : 'We could not activate this invitation. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function accept() {
    setError(null);
    if (!token) {
      setState('invalid');
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/staff-invitations/accept', {
        body: JSON.stringify({ token }),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      if (!response.ok) {
        const message = responseMessage(
          await response.json().catch(() => null),
          'We could not accept this invitation. Please try again.',
        );
        if (isUnavailableMessage(message)) {
          setState('invalid');
          return;
        }
        throw new Error(message);
      }
      setSuccessMode('accepted');
      setState('success');
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : 'We could not accept this invitation. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'loading') {
    return (
      <AuthShell sectionLabelledBy="invitation-loading-title">
        <div className={styles.support}>
          <span className={styles.supportLabel}>Need help?</span>
          <a className={styles.supportLink} href="mailto:dejvis@must.al">
            Contact administrator
          </a>
        </div>
        <Badge className={styles.statusBadge} tone="success">
          <img alt="" className={styles.badgeIcon} src={authAssets.shieldCheck} />
          <span>SECURE INVITATION</span>
        </Badge>
        <Heading className={styles.formTitle} id="invitation-loading-title">
          You&apos;re invited to join.
        </Heading>
        <Text className={styles.formDescription} tone="secondary">
          Checking your invitation and account access…
        </Text>
        <div aria-live="polite" role="status">
          <Card className={styles.statusCard}>
            <span className={styles.statusIcon}>
              <img alt="" height="18" src={authAssets.shieldCheckExact} width="18" />
            </span>
            <span className={styles.statusCopy}>
              <span className={styles.statusTitle}>Preparing secure access</span>
              <span className={styles.statusDescription}>This will only take a moment.</span>
            </span>
          </Card>
        </div>
      </AuthShell>
    );
  }

  if (state === 'invalid') {
    return (
      <AuthShell sectionLabelledBy="invitation-unavailable-title">
        <div className={styles.support}>
          <span className={styles.supportLabel}>Need a new invitation?</span>
          <a className={styles.supportLink} href="mailto:dejvis@must.al">
            Contact administrator
          </a>
        </div>
        <Badge className={styles.errorBadge} tone="danger">
          <img alt="" className={styles.badgeIcon} src={authAssets.shieldAlert} />
          <span>INVITATION UNAVAILABLE</span>
        </Badge>
        <Heading className={styles.formTitle} id="invitation-unavailable-title">
          Request a fresh invitation.
        </Heading>
        <Text className={styles.formDescription} tone="secondary">
          This invitation is invalid, expired, or has already been used. No account access was
          changed.
        </Text>
        <Alert className={styles.errorAlert} role="alert" tone="danger">
          <img alt="" className={styles.errorIcon} src={authAssets.shieldAlert} />
          <span>{error || 'Ask your hotel administrator to send a new invitation.'}</span>
        </Alert>
        <a
          className={`${styles.actionButton} must-button must-button--primary ${styles.backLink}`}
          href="/login"
        >
          Back to sign in
        </a>
      </AuthShell>
    );
  }

  if (state === 'success') {
    const existingUser = successMode === 'accepted';
    return (
      <AuthShell sectionLabelledBy="invitation-success-title">
        <div className={styles.support}>
          <span className={styles.supportLabel}>Need help?</span>
          <a className={styles.supportLink} href="mailto:dejvis@must.al">
            Contact administrator
          </a>
        </div>
        <Badge className={styles.statusBadge} tone="success">
          <img alt="" className={styles.badgeIcon} src={authAssets.shieldCheck} />
          <span>INVITATION ACCEPTED</span>
        </Badge>
        <Heading className={styles.formTitle} id="invitation-success-title">
          Welcome to the team.
        </Heading>
        <Text className={styles.formDescription} tone="secondary">
          {existingUser
            ? 'Your workspace access is ready. Continue to your hotel operations dashboard.'
            : 'Your account is ready. Sign in with your new password to continue to hotel operations.'}
        </Text>
        <Card className={styles.statusCard}>
          <span className={styles.statusIcon}>
            <img alt="" height="18" src={authAssets.shieldCheckExact} width="18" />
          </span>
          <span className={styles.statusCopy}>
            <span className={styles.statusTitle}>Access assigned securely</span>
            <span className={styles.statusDescription}>
              Your invitation was used once and the assigned workspace access is now protected.
            </span>
          </span>
        </Card>
        <div className={styles.actions}>
          <a
            className={`${styles.actionButton} must-button must-button--primary`}
            href={existingUser ? '/dashboard' : '/login'}
          >
            {existingUser ? 'Continue to workspace' : 'Go to sign in'}
          </a>
        </div>
      </AuthShell>
    );
  }

  if (state === 'accept') {
    return (
      <AuthShell sectionLabelledBy="invitation-accept-title">
        <div className={styles.support}>
          <span className={styles.supportLabel}>Need help?</span>
          <a className={styles.supportLink} href="mailto:dejvis@must.al">
            Contact administrator
          </a>
        </div>
        <Badge className={styles.statusBadge} tone="success">
          <img alt="" className={styles.badgeIcon} src={authAssets.shieldCheck} />
          <span>INVITATION READY</span>
        </Badge>
        <Heading className={styles.formTitle} id="invitation-accept-title">
          Join your hotel team.
        </Heading>
        <Text className={styles.formDescription} tone="secondary">
          You&apos;re signed in as <span className={styles.sessionEmail}>{sessionEmail}</span>.
          Accept this invitation to add the assigned workspace access to your account.
        </Text>
        {error ? (
          <Alert className={styles.errorAlert} role="alert" tone="danger">
            <img alt="" className={styles.errorIcon} src={authAssets.shieldAlert} />
            <span>{error}</span>
          </Alert>
        ) : null}
        <Card className={styles.note}>
          <span className={styles.noteIcon}>
            <img alt="" height="18" src={authAssets.shieldCheckExact} width="18" />
          </span>
          <span className={styles.noteCopy}>
            <span className={styles.noteTitle}>Permission-aware access</span>
            <span className={styles.noteDescription}>
              You&apos;ll receive only the properties and capabilities assigned by the hotel
              administrator.
            </span>
          </span>
        </Card>
        <div className={styles.actions}>
          <Button
            className={styles.actionButton}
            disabled={submitting}
            onClick={() => void accept()}
            type="button"
          >
            {submitting ? 'Accepting…' : 'Accept invitation'}
            <img alt="" className={styles.submitArrow} src={authAssets.arrowRight} />
          </Button>
          <a className={`${styles.actionButton} must-button must-button--secondary`} href="/login">
            Return to sign in
          </a>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell sectionLabelledBy="invitation-activate-title">
      <div className={styles.support}>
        <span className={styles.supportLabel}>Already have an account?</span>
        <a className={styles.supportLink} href="/login">
          Sign in first
        </a>
      </div>
      <Badge className={styles.statusBadge} tone="success">
        <img alt="" className={styles.badgeIcon} src={authAssets.shieldCheck} />
        <span>SECURE INVITATION</span>
      </Badge>
      <Heading className={styles.formTitle} id="invitation-activate-title">
        Join your hotel team.
      </Heading>
      <Text className={styles.formDescription} tone="secondary">
        Create your staff account to accept the invitation and access your assigned hotel workspace.
      </Text>
      {error ? (
        <Alert className={styles.errorAlert} id="invitation-error" role="alert" tone="danger">
          <img alt="" className={styles.errorIcon} src={authAssets.shieldAlert} />
          <span>{error}</span>
        </Alert>
      ) : null}
      <form
        aria-describedby={error ? 'invitation-error' : undefined}
        className={styles.form}
        onSubmit={activate}
      >
        <div className={styles.field}>
          <TextInput
            autoComplete="email"
            label="Email address"
            name="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@hotel.com"
            required
            startAdornment={<img alt="" height="18" src={authAssets.email} width="18" />}
            type="email"
            value={email}
          />
        </div>
        <div className={styles.field}>
          <TextInput
            autoComplete="new-password"
            endAdornment={
              <button
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className={styles.passwordToggle}
                onClick={() => setShowPassword((visible) => !visible)}
                type="button"
              >
                <img alt="" src={showPassword ? authAssets.eyeOff : authAssets.eye} />
              </button>
            }
            hint="Use at least 12 characters."
            label="Password"
            minLength={12}
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            startAdornment={<img alt="" height="18" src={authAssets.lock} width="18" />}
            type={showPassword ? 'text' : 'password'}
            value={password}
          />
        </div>
        <div className={styles.field}>
          <TextInput
            autoComplete="new-password"
            endAdornment={
              <button
                aria-label={
                  showConfirmation ? 'Hide password confirmation' : 'Show password confirmation'
                }
                aria-pressed={showConfirmation}
                className={styles.passwordToggle}
                onClick={() => setShowConfirmation((visible) => !visible)}
                type="button"
              >
                <img alt="" src={showConfirmation ? authAssets.eyeOff : authAssets.eye} />
              </button>
            }
            label="Confirm password"
            name="passwordConfirmation"
            onChange={(event) => setConfirmation(event.target.value)}
            required
            startAdornment={<img alt="" height="18" src={authAssets.lock} width="18" />}
            type={showConfirmation ? 'text' : 'password'}
            value={confirmation}
          />
        </div>
        <Button className={styles.submitButton} disabled={submitting} type="submit">
          {submitting ? 'Creating account…' : 'Create account & accept invitation'}
          <img alt="" className={styles.submitArrow} src={authAssets.arrowRight} />
        </Button>
      </form>
      <Card className={styles.note}>
        <span className={styles.noteIcon}>
          <img alt="" height="18" src={authAssets.shieldCheckExact} width="18" />
        </span>
        <span className={styles.noteCopy}>
          <span className={styles.noteTitle}>Permission-aware access</span>
          <span className={styles.noteDescription}>
            Your administrator controls which properties and capabilities this account can use.
          </span>
        </span>
      </Card>
      <a className={styles.backLink} href="/login">
        Back to sign in
      </a>
    </AuthShell>
  );
}
