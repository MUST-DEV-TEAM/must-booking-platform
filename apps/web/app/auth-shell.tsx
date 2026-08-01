import type { ReactNode } from 'react';

import { Heading } from '@must/ui';

import styles from './login/login.module.css';

export const authAssets = {
  arrowRight: '/auth/icon-arrow-right.svg',
  check: '/auth/icon-check.svg',
  email: '/auth/icon-email.svg',
  eye: '/auth/icon-eye.svg',
  eyeOff: '/auth/icon-eye-off.svg',
  lock: '/auth/icon-lock.svg',
  portalMark: '/auth/portal-m-mark.svg',
  shieldAlert: '/auth/icon-shield-alert.svg',
  shieldCheck: '/auth/icon-shield-check.svg',
  shieldCheckExact: '/auth/icon-shield-check-exact.svg',
} as const;

export function AuthBrandPanel() {
  const benefits = [
    ['One operational workspace', 'Bookings, payments and inventory stay connected.'],
    ['Safe by default', 'Sensitive actions remain permission-controlled and auditable.'],
    [
      'Provider-aware workflows',
      'Clock PMS and PokPay states are surfaced without exposing secrets.',
    ],
  ];

  return (
    <section aria-label="MUST Hotel Reservation Operations" className={styles.brandPanel}>
      <div className={styles.brandLogo}>
        <img alt="" className={styles.brandLogoMark} src={authAssets.portalMark} />
        <div className={styles.brandLogoCopy}>
          <span className={styles.brandLogoName}>MUST Hotel</span>
          <span className={styles.brandLogoSubline}>Reservation operations</span>
        </div>
      </div>
      <div className={styles.contextBadge}>
        <img alt="" className={styles.secureBadgeIcon} src={authAssets.shieldCheck} />
        <span className={styles.contextBadgeText}>SECURE STAFF OPERATIONS</span>
      </div>
      <h1 className={styles.brandHeadline}>
        Run every stay
        <br />
        with confidence.
      </h1>
      <p className={styles.brandDescription}>
        Access reservations, payments, inventory and provider operations from one protected
        workspace.
      </p>
      <div className={styles.benefits}>
        {benefits.map(([title, description]) => (
          <div className={styles.benefit} key={title}>
            <span className={styles.benefitIcon}>
              <img alt="" height="16" src={authAssets.check} width="16" />
            </span>
            <span className={styles.benefitCopy}>
              <span className={styles.benefitTitle}>{title}</span>
              <span className={styles.benefitDescription}>{description}</span>
            </span>
          </div>
        ))}
      </div>
      <p className={styles.brandFooter}>MUST Hotel Reservation Operations</p>
    </section>
  );
}

export function AuthFooter() {
  return (
    <footer className={styles.footer}>
      <span className={styles.footerText}>MUST Hotel Reservation Operations</span>
      <span className={styles.footerText}>·</span>
      <a className={styles.footerLink} href="/terms">
        Terms &amp; Conditions
      </a>
      <span className={styles.footerText}>·</span>
      <a className={styles.footerLink} href="/privacy">
        Privacy Policy
      </a>
    </footer>
  );
}

export function AuthShell({
  children,
  sectionLabel,
  sectionLabelledBy,
  shellClassName,
}: {
  children: ReactNode;
  sectionLabel?: string;
  sectionLabelledBy?: string;
  shellClassName?: string;
}) {
  return (
    <main className={styles.page}>
      <div className={[styles.shell, shellClassName].filter(Boolean).join(' ')}>
        <AuthBrandPanel />
        <section
          aria-label={sectionLabel}
          aria-labelledby={sectionLabelledBy}
          className={styles.formPanel}
        >
          {children}
          <AuthFooter />
        </section>
      </div>
    </main>
  );
}

export function AuthDocumentPage({ children, title }: { children: ReactNode; title: string }) {
  return (
    <AuthShell sectionLabel={title}>
      <article className={styles.documentContent}>
        <Heading className={styles.documentTitle}>{title}</Heading>
        <div className={styles.documentBody}>{children}</div>
        <a className={styles.documentBackLink} href="/login">
          Back to login
        </a>
      </article>
    </AuthShell>
  );
}
