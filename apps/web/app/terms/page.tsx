'use client';

import { Text } from '@must/ui';

import { AuthDocumentPage } from '../auth-shell';

export default function TermsPage() {
  return (
    <AuthDocumentPage title="Terms & Conditions">
      <Text>
        This placeholder page will describe the terms for using MUST Hotel Reservation Operations.
        It is not final legal text.
      </Text>
      <Text>Final terms will be reviewed and published before launch.</Text>
    </AuthDocumentPage>
  );
}
