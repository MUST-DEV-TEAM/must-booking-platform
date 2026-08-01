'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Alert, Badge, Button, Card, Heading, Text } from '@must/ui';

import {
  authDestination,
  fetchSessionUser,
  loginPath,
  type LoginReason,
  type SessionUser,
} from './auth-routing';
import { authAssets, AuthShell } from './auth-shell';
import styles from './auth-status.module.css';

function initials(email: string): string {
  return (
    email
      .split('@')[0]
      .replace(/[^a-z0-9]/gi, '')
      .slice(0, 2)
      .toUpperCase() || 'M'
  );
}

export function AuthStatusView({ reason, returnTo }: { reason: LoginReason; returnTo?: string }) {
  const router = useRouter();
  const [sessionUser, setSessionUser] = useState<SessionUser | null | undefined>(
    reason === 'logout-confirmation' ? undefined : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (reason !== 'logout-confirmation') return;
    void fetchSessionUser()
      .then((user) => {
        if (user) {
          setSessionUser(user);
        } else {
          router.replace(loginPath('logged-out', returnTo));
        }
      })
      .catch(() => setError('We could not confirm the current session. Please try again.'));
  }, [reason, returnTo, router]);

  async function signOut() {
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch('/api/auth/logout', {
        credentials: 'include',
        method: 'POST',
      });
      if (!response.ok) throw new Error('We could not sign you out. Please try again.');
      router.replace(loginPath('logged-out', returnTo));
    } catch (logoutError) {
      setError(
        logoutError instanceof Error
          ? logoutError.message
          : 'We could not sign you out. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (reason === 'session-expired') {
    return (
      <AuthShell sectionLabelledBy="session-expired-title">
        <div className={styles.support}>
          <span className={styles.supportLabel}>Need help?</span>
          <a className={styles.supportLink} href="mailto:dejvis@must.al">
            Contact administrator
          </a>
        </div>
        <Badge className={`${styles.badge} ${styles.warningBadge}`} tone="warning">
          <img alt="" className={styles.badgeIcon} src={authAssets.shieldAlert} />
          <span>SESSION EXPIRED</span>
        </Badge>
        <Heading className={styles.formTitle} id="session-expired-title">
          Your session expired
        </Heading>
        <Text className={styles.formDescription} tone="secondary">
          For security, your session ended after a period of inactivity. Sign in again to continue.
        </Text>
        <Card className={`${styles.notice} ${styles.warningNotice}`}>
          <span className={styles.noticeIcon}>
            <img alt="" className={styles.errorIcon} src={authAssets.shieldAlert} />
          </span>
          <span className={styles.noticeCopy}>
            <span className={styles.noticeTitle}>No sensitive action continued</span>
            <span className={styles.noticeDescription}>
              Any unfinished action was stopped before it could change booking, payment or provider
              data.
            </span>
          </span>
        </Card>
        <div className={styles.actions}>
          <a
            className={`${styles.actionButton} ${styles.primaryAction} must-button must-button--primary`}
            href={loginPath(undefined, returnTo)}
          >
            Sign in again
            <img alt="" className={styles.submitArrow} src={authAssets.arrowRight} />
          </a>
          <a className={`${styles.actionButton} ${styles.secondaryAction}`} href="/">
            Return to hotel website
          </a>
        </div>
        <Card className={`${styles.notice} ${styles.successNotice}`}>
          <span className={styles.noticeIcon}>
            <img alt="" height="18" src={authAssets.shieldCheckExact} width="18" />
          </span>
          <span className={styles.noticeCopy}>
            <span className={styles.noticeTitle}>Before continuing</span>
            <span className={styles.noticeDescription}>
              After signing in, review the latest reservation and payment states before repeating an
              action.
            </span>
          </span>
        </Card>
      </AuthShell>
    );
  }

  if (reason === 'logout-confirmation') {
    if (!sessionUser) {
      return (
        <AuthShell sectionLabelledBy="logout-confirmation-loading-title">
          <div className={styles.support}>
            <span className={styles.supportLabel}>Need help?</span>
            <a className={styles.supportLink} href="mailto:dejvis@must.al">
              Contact administrator
            </a>
          </div>
          <Badge className={`${styles.badge} ${styles.warningBadge}`} tone="warning">
            <img alt="" className={styles.badgeIcon} src={authAssets.shieldAlert} />
            <span>CONFIRM SIGN OUT</span>
          </Badge>
          <Heading className={styles.formTitle} id="logout-confirmation-loading-title">
            End this session safely.
          </Heading>
          <Text className={styles.formDescription} tone="secondary">
            Checking the current administrator session…
          </Text>
          {error ? (
            <Alert className={styles.errorAlert} role="alert" tone="danger">
              <img alt="" className={styles.errorIcon} src={authAssets.shieldAlert} />
              <span>{error}</span>
            </Alert>
          ) : null}
        </AuthShell>
      );
    }

    const cancelPath = authDestination(sessionUser);
    return (
      <AuthShell sectionLabelledBy="logout-confirmation-title">
        <div className={styles.support}>
          <span className={styles.supportLabel}>Need help?</span>
          <a className={styles.supportLink} href="mailto:dejvis@must.al">
            Contact administrator
          </a>
        </div>
        <Badge className={`${styles.badge} ${styles.warningBadge}`} tone="warning">
          <img alt="" className={styles.badgeIcon} src={authAssets.shieldAlert} />
          <span>CONFIRM SIGN OUT</span>
        </Badge>
        <Heading className={styles.formTitle} id="logout-confirmation-title">
          Sign out of MUST Hotel?
        </Heading>
        <Text className={styles.formDescription} tone="secondary">
          You are about to end the current administrator session on this device.
        </Text>
        <Card className={styles.userCard}>
          <span className={styles.userAvatar}>{initials(sessionUser.email)}</span>
          <span className={styles.userCopy}>
            <span className={styles.userName}>{sessionUser.email}</span>
            <span className={styles.userMeta}>
              {sessionUser.isPlatformAdmin ? 'Platform administrator' : 'Hotel administrator'} ·
              Current session · This browser
            </span>
          </span>
        </Card>
        <Card className={`${styles.notice} ${styles.warningNotice}`}>
          <span className={styles.noticeCopy}>
            <span className={styles.noticeTitle}>Any unsaved form changes will be lost</span>
            <span className={styles.noticeDescription}>
              Completed reservations and payments remain saved. Only unfinished edits on this screen
              are discarded.
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
          <a className={`${styles.actionButton} ${styles.secondaryAction}`} href={cancelPath}>
            Cancel
          </a>
          <Button
            className={`${styles.actionButton} ${styles.primaryAction}`}
            disabled={submitting}
            onClick={() => void signOut()}
            type="button"
          >
            {submitting ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell sectionLabelledBy="logged-out-title">
      <div className={styles.support}>
        <span className={styles.supportLabel}>Need help?</span>
        <a className={styles.supportLink} href="mailto:dejvis@must.al">
          Contact administrator
        </a>
      </div>
      <Badge className={`${styles.badge} ${styles.successBadge}`} tone="success">
        <img alt="" className={styles.badgeIcon} src={authAssets.shieldCheck} />
        <span>SIGNED OUT</span>
      </Badge>
      <Heading className={styles.formTitle} id="logged-out-title">
        You&apos;ve been signed out
      </Heading>
      <Text className={styles.formDescription} tone="secondary">
        Your session ended successfully. Sign in again whenever you need access to reservation
        operations.
      </Text>
      <div className={styles.illustration} aria-hidden="true">
        <img alt="" src={authAssets.shieldCheckExact} />
      </div>
      <Card className={`${styles.notice} ${styles.successNotice}`}>
        <span className={styles.noticeIcon}>
          <img alt="" height="18" src={authAssets.shieldCheckExact} width="18" />
        </span>
        <span className={styles.noticeCopy}>
          <span className={styles.noticeTitle}>Protected access closed</span>
          <span className={styles.noticeDescription}>
            This browser no longer has access to guest, payment or provider information from the
            previous session.
          </span>
        </span>
      </Card>
      <div className={styles.actions}>
        <a
          className={`${styles.actionButton} ${styles.primaryAction} must-button must-button--primary`}
          href={loginPath(undefined, returnTo)}
        >
          Sign in again
          <img alt="" className={styles.submitArrow} src={authAssets.arrowRight} />
        </a>
        <a className={`${styles.actionButton} ${styles.secondaryAction}`} href="/">
          Return to hotel website
        </a>
      </div>
    </AuthShell>
  );
}
