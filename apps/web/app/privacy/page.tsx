'use client';

import { Text } from '@must/ui';

import { AuthDocumentPage } from '../auth-shell';

export default function PrivacyPage() {
  return (
    <AuthDocumentPage title="Privacy Policy">
      <Text>
        This placeholder page will describe how MUST handles account and operational data. It is not
        final legal text.
      </Text>
      <Text>The final privacy policy will be reviewed and published before launch.</Text>
    </AuthDocumentPage>
  );
}
