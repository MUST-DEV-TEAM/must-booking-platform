'use client';

import { FormEvent, useEffect, useState } from 'react';

import { Alert, Badge, Button, Card, Heading, Text, TextInput } from '@must/ui';

import { authAssets, AuthShell } from '../auth-shell';
import styles from '../password-reset.module.css';

type ResetState = 'form' | 'success' | 'invalid';

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<ResetState>('form');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const suppliedToken = new URLSearchParams(window.location.search).get('token');
    setToken(suppliedToken);
    if (!suppliedToken) setState('invalid');
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
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
      const response = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!response.ok) {
        if (response.status === 400) {
          setState('invalid');
          return;
        }
        const body = (await response.json().catch(() => null)) as {
          message?: string | string[];
        } | null;
        const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message;
        throw new Error(message || 'We could not update your password. Please try again.');
      }
      setState('success');
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : 'We could not update your password. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'success') {
    return (
      <AuthShell sectionLabelledBy="password-updated-title">
        <div className={styles.support}>
          <span className={styles.supportLabel}>Need help?</span>
          <a className={styles.supportLink} href="mailto:dejvis@must.al">
            Contact administrator
          </a>
        </div>
        <Badge className={styles.statusBadge} tone="success">
          <img alt="" className={styles.badgeIcon} src={authAssets.shieldCheck} />
          <span>PASSWORD UPDATED</span>
        </Badge>
        <Heading className={styles.formTitle} id="password-updated-title">
          Access restored safely.
        </Heading>
        <Text className={styles.formDescription} tone="secondary">
          Your password has been updated. Sign in with your new password to return to your hotel
          operations workspace.
        </Text>
        <Card className={styles.statusCard}>
          <span className={styles.statusIcon}>
            <img alt="" height="18" src={authAssets.shieldCheckExact} width="18" />
          </span>
          <span className={styles.statusCopy}>
            <span className={styles.statusTitle}>Account access restored</span>
            <span className={styles.statusDescription}>
              Your password was updated and your account remains protected.
            </span>
          </span>
        </Card>
        <a
          className={`${styles.actionButton} must-button must-button--primary ${styles.backLink}`}
          href="/login"
        >
          Go to sign in
        </a>
      </AuthShell>
    );
  }

  if (state === 'invalid') {
    return (
      <AuthShell sectionLabelledBy="reset-link-unavailable-title">
        <div className={styles.support}>
          <span className={styles.supportLabel}>Need help?</span>
          <a className={styles.supportLink} href="mailto:dejvis@must.al">
            Contact administrator
          </a>
        </div>
        <Badge className={styles.errorBadge} tone="danger">
          <img alt="" className={styles.badgeIcon} src={authAssets.shieldAlert} />
          <span>RESET LINK UNAVAILABLE</span>
        </Badge>
        <Heading className={styles.formTitle} id="reset-link-unavailable-title">
          Request a fresh link.
        </Heading>
        <Text className={styles.formDescription} tone="secondary">
          This reset link is invalid, expired, or has already been used. No account changes were
          made.
        </Text>
        <Alert className={styles.errorAlert} role="alert" tone="danger">
          <img alt="" className={styles.errorIcon} src={authAssets.shieldAlert} />
          <span>{error || 'Reset links are single-use and expire automatically.'}</span>
        </Alert>
        <div className={styles.actions}>
          <a
            className={`${styles.actionButton} must-button must-button--primary`}
            href="/forgot-password"
          >
            Request new reset link
          </a>
          <a className={`${styles.actionButton} must-button must-button--secondary`} href="/login">
            Back to sign in
          </a>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell sectionLabelledBy="reset-password-title">
      <div className={styles.support}>
        <span className={styles.supportLabel}>Need help?</span>
        <a className={styles.supportLink} href="mailto:dejvis@must.al">
          Contact administrator
        </a>
      </div>
      <Badge className={styles.statusBadge} tone="success">
        <img alt="" className={styles.badgeIcon} src={authAssets.shieldCheck} />
        <span>CREATE NEW PASSWORD</span>
      </Badge>
      <Heading className={styles.formTitle} id="reset-password-title">
        Secure your account.
      </Heading>
      <Text className={styles.formDescription} tone="secondary">
        Choose a new password for your MUST Hotel Reservation Operations account.
      </Text>

      {error ? (
        <Alert className={styles.errorAlert} id="reset-password-error" role="alert" tone="danger">
          <img alt="" className={styles.errorIcon} src={authAssets.shieldAlert} />
          <span>{error}</span>
        </Alert>
      ) : null}

      <form
        aria-describedby={error ? 'reset-password-error' : undefined}
        className={styles.form}
        onSubmit={submit}
      >
        <div className={styles.field}>
          <TextInput
            autoComplete="new-password"
            endAdornment={
              <button
                aria-label={showPassword ? 'Hide new password' : 'Show new password'}
                aria-pressed={showPassword}
                className={styles.passwordToggle}
                onClick={() => setShowPassword((visible) => !visible)}
                type="button"
              >
                <img alt="" src={showPassword ? authAssets.eyeOff : authAssets.eye} />
              </button>
            }
            hint="Use at least 12 characters."
            label="New password"
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
            label="Confirm new password"
            name="passwordConfirmation"
            onChange={(event) => setConfirmation(event.target.value)}
            required
            startAdornment={<img alt="" height="18" src={authAssets.lock} width="18" />}
            type={showConfirmation ? 'text' : 'password'}
            value={confirmation}
          />
        </div>
        <ul className={styles.resetRequirements}>
          <li>At least 12 characters</li>
          <li>One-time reset session</li>
          <li>Existing operations stay protected</li>
        </ul>
        <Button className={styles.submitButton} disabled={submitting} type="submit">
          {submitting ? 'Updating password…' : 'Reset password'}
          <img alt="" className={styles.submitArrow} src={authAssets.arrowRight} />
        </Button>
      </form>
      <a className={styles.backLink} href="/login">
        Cancel and return to sign in
      </a>
    </AuthShell>
  );
}
