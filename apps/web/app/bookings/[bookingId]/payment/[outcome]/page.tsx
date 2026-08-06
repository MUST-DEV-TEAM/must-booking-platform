'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { Alert, Badge, Card, Heading, Text } from '@must/ui';

import { authAssets, AuthShell } from '../../../../auth-shell';
import styles from './payment-outcome.module.css';

const REDIRECT_DELAY_MS = 5000;

export default function BookingPaymentOutcomePage() {
  const router = useRouter();
  const params = useParams<{ bookingId: string; outcome: string }>();
  const isCancelled = params.outcome === 'cancel';

  useEffect(() => {
    const timer = setTimeout(() => router.replace('/dashboard'), REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <AuthShell sectionLabelledBy="payment-outcome-title">
      <div className={styles.support}>
        <span className={styles.supportLabel}>Need help?</span>
        <a className={styles.supportLink} href="mailto:dejvis@must.al">
          Contact administrator
        </a>
      </div>

      <Badge
        className={isCancelled ? styles.errorBadge : styles.statusBadge}
        tone={isCancelled ? 'danger' : 'success'}
      >
        <img
          alt=""
          className={styles.badgeIcon}
          src={isCancelled ? authAssets.shieldAlert : authAssets.shieldCheck}
        />
        <span>{isCancelled ? 'PAYMENT NOT COMPLETED' : 'PAYMENT RECEIVED'}</span>
      </Badge>
      <Heading className={styles.formTitle} id="payment-outcome-title">
        {isCancelled ? 'Payment was not completed' : 'Payment received'}
      </Heading>
      <Text className={styles.formDescription} tone="secondary">
        {isCancelled
          ? 'The checkout was cancelled before payment was completed. This booking has not been charged.'
          : 'The booking will confirm automatically once the payment finishes processing. You can check its status now in Reservations.'}
      </Text>

      {isCancelled ? (
        <Alert className={styles.errorAlert} role="alert" tone="danger">
          <img alt="" className={styles.errorIcon} src={authAssets.shieldAlert} />
          <span>No charge was made. You can start the payment again from the booking.</span>
        </Alert>
      ) : (
        <div aria-live="polite" role="status">
          <Card className={styles.statusCard}>
            <span className={styles.statusIcon}>
              <img alt="" height="18" src={authAssets.shieldCheckExact} width="18" />
            </span>
            <span className={styles.statusCopy}>
              <span className={styles.statusTitle}>Payment received</span>
              <span className={styles.statusDescription}>Taking you back to the dashboard…</span>
            </span>
          </Card>
        </div>
      )}

      <a className={`${styles.backLink} must-button must-button--secondary`} href="/dashboard">
        Go to dashboard
      </a>
    </AuthShell>
  );
}
