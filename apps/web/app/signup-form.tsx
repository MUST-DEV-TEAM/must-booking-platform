'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Alert, Badge, Button, Card, Heading, Text, TextInput } from '@must/ui';

import { authAssets, AuthShell } from './auth-shell';
import styles from './signup.module.css';

type SignupFields = {
  organizationName: string;
  propertyName: string;
  propertyAddress: string;
  propertyTimezone: string;
  email: string;
  password: string;
};

const initialFields: SignupFields = {
  organizationName: '',
  propertyName: '',
  propertyAddress: '',
  propertyTimezone: 'Europe/Tirane',
  email: '',
  password: '',
};

export function SignupForm() {
  const router = useRouter();
  const [fields, setFields] = useState(initialFields);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string | string[];
        } | null;
        const message = Array.isArray(body?.message) ? body.message.join(' ') : body?.message;
        throw new Error(message || 'We could not create your workspace. Please try again.');
      }
      router.push('/dashboard');
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : 'We could not create your workspace. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthShell sectionLabelledBy="signup-title">
      <div className={styles.support}>
        <span className={styles.supportLabel}>Already have an account?</span>
        <a className={styles.supportLink} href="/login">
          Sign in
        </a>
      </div>

      <Badge className={styles.planBadge} tone="success">
        <img alt="" className={styles.badgeIcon} src={authAssets.check} />
        <span>FREE PLAN · NO CARD REQUIRED</span>
      </Badge>
      <Heading className={styles.formTitle} id="signup-title">
        Create your workspace
      </Heading>
      <Text className={styles.formDescription} tone="secondary">
        Set up your hotel operations workspace and start managing stays with the permanent Free
        plan.
      </Text>

      {error ? (
        <Alert className={styles.errorAlert} id="signup-error" role="alert" tone="danger">
          <img alt="" className={styles.errorIcon} src={authAssets.shieldAlert} />
          <span>{error}</span>
        </Alert>
      ) : null}

      <form
        aria-describedby={error ? 'signup-error' : undefined}
        className={styles.form}
        onSubmit={submit}
      >
        <fieldset className={styles.section} disabled={submitting}>
          <legend className={styles.sectionTitle}>Your hotel</legend>
          <div className={styles.fields}>
            <div className={styles.field}>
              <TextInput
                autoComplete="organization"
                label="Organization name"
                name="organizationName"
                onChange={(event) => setFields({ ...fields, organizationName: event.target.value })}
                required
                value={fields.organizationName}
              />
            </div>
            <div className={styles.field}>
              <TextInput
                label="First property name"
                name="propertyName"
                onChange={(event) => setFields({ ...fields, propertyName: event.target.value })}
                required
                value={fields.propertyName}
              />
            </div>
            <label className={`${styles.field} ${styles.fieldFull}`} htmlFor="property-address">
              <span className={styles.fieldLabel}>Property address</span>
              <textarea
                id="property-address"
                name="propertyAddress"
                onChange={(event) => setFields({ ...fields, propertyAddress: event.target.value })}
                required
                rows={3}
                value={fields.propertyAddress}
              />
            </label>
            <div className={styles.field}>
              <TextInput
                autoComplete="off"
                label="Property timezone"
                name="propertyTimezone"
                onChange={(event) => setFields({ ...fields, propertyTimezone: event.target.value })}
                required
                value={fields.propertyTimezone}
              />
            </div>
          </div>
        </fieldset>

        <fieldset className={styles.section} disabled={submitting}>
          <legend className={styles.sectionTitle}>Your admin account</legend>
          <div className={styles.fields}>
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
                    <img
                      alt=""
                      height="16"
                      src={showPassword ? authAssets.eyeOff : authAssets.eye}
                      width="16"
                    />
                  </button>
                }
                label="Password"
                minLength={12}
                name="password"
                onChange={(event) => setFields({ ...fields, password: event.target.value })}
                placeholder="At least 12 characters"
                required
                startAdornment={<img alt="" height="18" src={authAssets.lock} width="18" />}
                type={showPassword ? 'text' : 'password'}
                value={fields.password}
              />
            </div>
          </div>
        </fieldset>

        <Text className={styles.passwordHint} tone="secondary">
          Use at least 12 characters. You can add staff and properties after your workspace is
          created.
        </Text>
        <Button className={styles.submitButton} disabled={submitting} type="submit">
          {submitting ? 'Creating workspace…' : 'Create free workspace'}
          <img alt="" className={styles.submitArrow} src={authAssets.arrowRight} />
        </Button>
      </form>

      <Card className={styles.freePlanNote}>
        <span className={styles.freePlanIcon}>
          <img alt="" height="18" src={authAssets.shieldCheckExact} width="18" />
        </span>
        <span className={styles.freePlanCopy}>
          <span className={styles.freePlanTitle}>A simple place to start</span>
          <span className={styles.freePlanDescription}>
            No payment card is required. Your workspace starts on MUST&apos;s permanent Free plan.
          </span>
        </span>
      </Card>
    </AuthShell>
  );
}
