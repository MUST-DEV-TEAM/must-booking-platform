import { Heading, Text } from '@must/ui';

import { AuthShell } from './auth-shell';
import { HomeAuthRedirect } from './auth-routing';
import styles from './login/login.module.css';

export default function Home() {
  return (
    <HomeAuthRedirect>
      <AuthShell sectionLabelledBy="home-title">
        <div className={styles.documentContent}>
          <Heading className={styles.documentTitle} id="home-title">
            Welcome to MUST Hotel
          </Heading>
          <Text tone="secondary">One protected workspace for your reservation operations.</Text>
          <div className={styles.actions}>
            <a className={`${styles.actionButton} must-button must-button--primary`} href="/login">
              Login
            </a>
            <a
              className={`${styles.actionButton} must-button must-button--secondary`}
              href="/signup"
            >
              Sign up
            </a>
          </div>
        </div>
      </AuthShell>
    </HomeAuthRedirect>
  );
}
