'use client';

import { FormEvent, useState } from 'react';

import { Alert, Badge, Button, Card, Heading, Text, TextInput } from '@must/ui';

import { authAssets, AuthShell } from '../auth-shell';
import styles from '../password-reset.module.css';

type RequestState = 'form' | 'sent';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<RequestState>('form');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function requestReset(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string | string[];
        } | null;
        const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message;
        throw new Error(message || 'We could not process that request. Please try again.');
      }
      setState('sent');
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : 'We could not process that request. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'sent') {
    return (
      <AuthShell sectionLabelledBy="reset-link-sent-title">
        <div className={styles.support}>
          <span className={styles.supportLabel}>Need help?</span>
          <a className={styles.supportLink} href="mailto:dejvis@must.al">
            Contact administrator
          </a>
        </div>

        <Badge className={styles.statusBadge} tone="success">
          <img alt="" className={styles.badgeIcon} src={authAssets.email} />
          <span>RESET LINK SENT</span>
        </Badge>
        <Heading className={styles.formTitle} id="reset-link-sent-title">
          Check your inbox.
        </Heading>
        <Text className={styles.formDescription} tone="secondary">
          If an account exists for that email address, we sent a secure reset link. The response is
          intentionally the same for every address.
        </Text>

        <Card className={styles.statusCard}>
          <span className={styles.statusIcon}>
            <img alt="" height="18" src={authAssets.shieldCheckExact} width="18" />
          </span>
          <span className={styles.statusCopy}>
            <span className={styles.statusTitle}>Reset instructions are on their way</span>
            <span className={styles.statusDescription}>
              Check your inbox and spam folder. The link expires automatically and can be used once.
            </span>
          </span>
        </Card>

        {error ? (
          <Alert className={styles.errorAlert} role="alert" tone="danger">
            <img alt="" className={styles.errorIcon} src={authAssets.shieldAlert} />
            <span>{error}</span>
          </Alert>
        ) : null}

        <div className={styles.actions}>
          <a className={`${styles.actionButton} must-button must-button--primary`} href="/login">
            Back to sign in
          </a>
          <Button
            className={styles.actionButton}
            disabled={submitting}
            onClick={() => void requestReset()}
            type="button"
            variant="secondary"
          >
            {submitting ? 'Sending…' : 'Resend email'}
          </Button>
        </div>
        <button className={styles.secondaryLink} onClick={() => setState('form')} type="button">
          Use a different email
        </button>
      </AuthShell>
    );
  }

  return (
    <AuthShell sectionLabelledBy="forgot-password-title">
      <div className={styles.support}>
        <span className={styles.supportLabel}>Need help?</span>
        <a className={styles.supportLink} href="mailto:dejvis@must.al">
          Contact administrator
        </a>
      </div>

      <Badge className={styles.statusBadge} tone="success">
        <img alt="" className={styles.badgeIcon} src={authAssets.shieldCheck} />
        <span>SECURE ACCOUNT RECOVERY</span>
      </Badge>
      <Heading className={styles.formTitle} id="forgot-password-title">
        Forgot password?
      </Heading>
      <Text className={styles.formDescription} tone="secondary">
        Enter your work email and we&apos;ll send a secure reset link if an account exists.
      </Text>

      {error ? (
        <Alert className={styles.errorAlert} id="forgot-password-error" role="alert" tone="danger">
          <img alt="" className={styles.errorIcon} src={authAssets.shieldAlert} />
          <span>{error}</span>
        </Alert>
      ) : null}

      <form
        aria-describedby={error ? 'forgot-password-error' : undefined}
        className={styles.form}
        onSubmit={requestReset}
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
        <Button className={styles.submitButton} disabled={submitting} type="submit">
          {submitting ? 'Sending…' : 'Send reset link'}
          <img alt="" className={styles.submitArrow} src={authAssets.arrowRight} />
        </Button>
      </form>

      <Card className={styles.note}>
        <span className={styles.noteIcon}>
          <img alt="" height="18" src={authAssets.shieldCheckExact} width="18" />
        </span>
        <span className={styles.noteCopy}>
          <span className={styles.noteTitle}>Privacy-safe recovery</span>
          <span className={styles.noteDescription}>
            We never reveal whether an email address is registered. Existing operations stay
            protected.
          </span>
        </span>
      </Card>
      <a className={styles.backLink} href="/login">
        Back to sign in
      </a>
    </AuthShell>
  );
}
