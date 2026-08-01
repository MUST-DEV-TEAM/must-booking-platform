'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Alert, Badge, Card, Heading, Text } from '@must/ui';

import { authAssets, AuthShell } from '../auth-shell';
import styles from './email-verification.module.css';

type VerificationState = 'verifying' | 'success' | 'error';

const messages = {
  verifying: 'Verifying your email…',
  success: 'Your email is verified. Redirecting to your dashboard…',
  invalid: 'This verification link is invalid or has expired.',
  failed: 'We could not verify your email. Please try the link again.',
} as const;

export default function EmailVerificationPage() {
  const router = useRouter();
  const [state, setState] = useState<VerificationState>('verifying');
  const [message, setMessage] = useState<string>(messages.verifying);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('token');
    if (!token) {
      setState('error');
      setMessage(messages.invalid);
      return;
    }

    void fetch('/api/auth/email-verification/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then((response) => {
        if (!response.ok) {
          setState('error');
          setMessage(messages.invalid);
          return;
        }
        setState('success');
        setMessage(messages.success);
        router.replace('/dashboard');
      })
      .catch(() => {
        setState('error');
        setMessage(messages.failed);
      });
  }, [router]);

  const isError = state === 'error';

  return (
    <AuthShell sectionLabelledBy="verification-title">
      <div className={styles.support}>
        <span className={styles.supportLabel}>Need help?</span>
        <a className={styles.supportLink} href="mailto:dejvis@must.al">
          Contact administrator
        </a>
      </div>

      <Badge
        className={isError ? styles.errorBadge : styles.statusBadge}
        tone={isError ? 'danger' : 'success'}
      >
        <img
          alt=""
          className={styles.badgeIcon}
          src={isError ? authAssets.shieldAlert : authAssets.shieldCheck}
        />
        <span>{isError ? 'VERIFICATION NEEDS ATTENTION' : 'SECURE EMAIL VERIFICATION'}</span>
      </Badge>
      <Heading className={styles.formTitle} id="verification-title">
        {state === 'verifying'
          ? 'Verify your email'
          : state === 'success'
            ? 'Email verified'
            : 'Verification link unavailable'}
      </Heading>
      <Text className={styles.formDescription} tone="secondary">
        {state === 'verifying'
          ? 'We are confirming your email so you can continue to your hotel operations workspace.'
          : state === 'success'
            ? 'Your account is ready. We are taking you to your dashboard now.'
            : 'This link can no longer be used. Request a new verification email or return to login.'}
      </Text>

      {isError ? (
        <Alert className={styles.errorAlert} role="alert" tone="danger">
          <img alt="" className={styles.errorIcon} src={authAssets.shieldAlert} />
          <span>{message}</span>
        </Alert>
      ) : (
        <div aria-live="polite" role="status">
          <Card className={styles.statusCard}>
            <span className={styles.statusIcon}>
              <img alt="" height="18" src={authAssets.shieldCheckExact} width="18" />
            </span>
            <span className={styles.statusCopy}>
              <span className={styles.statusTitle}>
                {state === 'success' ? 'Verification complete' : 'Checking your verification link'}
              </span>
              <span className={styles.statusDescription}>{message}</span>
            </span>
          </Card>
        </div>
      )}

      {isError ? (
        <a className={styles.backLink} href="/login">
          Back to login
        </a>
      ) : null}
    </AuthShell>
  );
}
