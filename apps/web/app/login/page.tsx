'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { Alert, Badge, Button, Card, Heading, Text, TextInput } from '@must/ui';

import { authAssets, AuthShell } from '../auth-shell';
import { authDestination, type LoginReason, type SessionUser } from '../auth-routing';
import { AuthStatusView } from '../auth-status';
import styles from './login.module.css';

/** Figma frames: 543:10000 (Login) and 543:10002 (Login Error). */
const genericLoginError = 'Incorrect email or password';
const genericLoginErrorDescription =
  'Check your credentials and try again. For security, we do not indicate which field was incorrect.';

type LoginFields = { email: string; password: string };

const initialFields: LoginFields = { email: '', password: '' };

export default function LoginPage() {
  const router = useRouter();
  const [authReason, setAuthReason] = useState<LoginReason | null>(null);
  const [returnTo, setReturnTo] = useState<string | undefined>();
  const [fields, setFields] = useState<LoginFields>(initialFields);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reason = params.get('reason');
    if (
      reason === 'session-expired' ||
      reason === 'logout-confirmation' ||
      reason === 'logged-out'
    ) {
      setAuthReason(reason);
    }
    const suppliedReturnTo = params.get('returnTo');
    if (suppliedReturnTo) setReturnTo(suppliedReturnTo);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(false);

    if (!fields.email.trim() || !fields.password) {
      setError(true);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/login', {
        body: JSON.stringify(fields),
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error(genericLoginError);
      }

      const body = (await response.json()) as { user: SessionUser };
      router.push(authDestination(body.user, returnTo));
    } catch {
      setError(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (authReason) {
    return <AuthStatusView reason={authReason} returnTo={returnTo} />;
  }

  return (
    <AuthShell
      sectionLabelledBy="login-title"
      shellClassName={error ? styles.errorState : undefined}
    >
      <div className={styles.support}>
        <span className={styles.supportLabel}>Need help?</span>
        <a className={styles.supportLink} href="mailto:dejvis@must.al">
          Contact administrator
        </a>
      </div>
      <Badge className={styles.secureBadge} tone="success">
        <img alt="" className={styles.secureBadgeIcon} src={authAssets.shieldCheck} />
        <span className={styles.secureBadgeText}>SECURE STAFF ACCESS</span>
      </Badge>
      <Heading className={styles.formTitle} id="login-title">
        Welcome back
      </Heading>
      <Text className={styles.formDescription} tone="secondary">
        Sign in with your hotel staff account to continue to reservation operations.
      </Text>

      {error ? (
        <Alert className={styles.errorAlert} id="login-error-summary" role="alert" tone="danger">
          <span className={styles.errorIcon}>
            <img alt="" height="18" src={authAssets.shieldAlert} width="18" />
          </span>
          <span className={styles.errorCopy}>
            <span className={styles.errorTitle}>{genericLoginError}</span>
            <span className={styles.errorDescription}>{genericLoginErrorDescription}</span>
          </span>
        </Alert>
      ) : null}

      <form
        aria-describedby={error ? 'login-error-summary' : undefined}
        className={styles.form}
        onSubmit={submit}
      >
        <div className={styles.field}>
          <TextInput
            autoComplete="email"
            label="Email address"
            name="email"
            onChange={(event) => setFields({ ...fields, email: event.target.value })}
            placeholder="name@hotel.com"
            required
            startAdornment={<img alt="" height="18" src={authAssets.email} width="18" />}
            type="email"
            value={fields.email}
          />
        </div>
        <div className={`${styles.field} ${error ? styles.errorInput : ''}`}>
          <TextInput
            aria-invalid={error || undefined}
            autoComplete="current-password"
            endAdornment={
              <button
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                className={styles.passwordToggle}
                onClick={() => setShowPassword((visible) => !visible)}
                type="button"
              >
                <img
                  alt=""
                  height="16"
                  src={showPassword ? authAssets.eyeOff : authAssets.eye}
                  width="16"
                />
              </button>
            }
            label="Password"
            name="password"
            onChange={(event) => setFields({ ...fields, password: event.target.value })}
            placeholder="Enter your password"
            required
            startAdornment={<img alt="" height="18" src={authAssets.lock} width="18" />}
            type={showPassword ? 'text' : 'password'}
            value={fields.password}
          />
        </div>
        <div className={styles.options}>
          <label className={styles.remember}>
            <input
              checked={rememberDevice}
              className={styles.rememberCheckbox}
              onChange={(event) => setRememberDevice(event.target.checked)}
              type="checkbox"
            />
            <span>Remember this device for 30 days</span>
          </label>
          <a className={styles.forgotLink} href="/forgot-password">
            Forgot password?
          </a>
        </div>
        <Button className={styles.submitButton} disabled={submitting} type="submit">
          {error ? 'Try again' : submitting ? 'Signing in…' : 'Sign in'}
          <img alt="" className={styles.submitArrow} src={authAssets.arrowRight} />
        </Button>
      </form>

      {!error ? (
        <>
          <div className={styles.divider}>AUTHORIZED ACCESS ONLY</div>
          <Card className={styles.protectedNote}>
            <span className={styles.protectedIcon}>
              <img alt="" height="18" src={authAssets.shieldCheckExact} width="18" />
            </span>
            <span className={styles.protectedCopy}>
              <span className={styles.protectedTitle}>Protected hotel operations</span>
              <span className={styles.protectedDescription}>
                Access attempts and sensitive actions may be logged for security and operational
                auditing.
              </span>
            </span>
          </Card>
        </>
      ) : null}
    </AuthShell>
  );
}
