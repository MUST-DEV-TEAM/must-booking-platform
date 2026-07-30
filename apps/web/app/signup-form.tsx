'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

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
    <form onSubmit={submit}>
      <fieldset disabled={submitting}>
        <legend>Your hotel</legend>
        <label>
          Organization name
          <input
            name="organizationName"
            value={fields.organizationName}
            onChange={(event) => setFields({ ...fields, organizationName: event.target.value })}
            autoComplete="organization"
            required
          />
        </label>
        <label>
          First property name
          <input
            name="propertyName"
            value={fields.propertyName}
            onChange={(event) => setFields({ ...fields, propertyName: event.target.value })}
            required
          />
        </label>
        <label>
          Property address
          <textarea
            name="propertyAddress"
            value={fields.propertyAddress}
            onChange={(event) => setFields({ ...fields, propertyAddress: event.target.value })}
            required
          />
        </label>
        <label>
          Property timezone
          <input
            name="propertyTimezone"
            value={fields.propertyTimezone}
            onChange={(event) => setFields({ ...fields, propertyTimezone: event.target.value })}
            autoComplete="off"
            required
          />
        </label>
      </fieldset>

      <fieldset disabled={submitting}>
        <legend>Your admin account</legend>
        <label>
          Email address
          <input
            name="email"
            type="email"
            value={fields.email}
            onChange={(event) => setFields({ ...fields, email: event.target.value })}
            autoComplete="email"
            required
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            value={fields.password}
            onChange={(event) => setFields({ ...fields, password: event.target.value })}
            autoComplete="new-password"
            minLength={12}
            required
          />
        </label>
      </fieldset>

      {error ? <p role="alert">{error}</p> : null}
      <button type="submit">{submitting ? 'Creating workspace…' : 'Create free workspace'}</button>
    </form>
  );
}
