import { it, expect } from 'vitest';
import { safeDeliveryError } from './email-activity.service';
it('explains missing sending configuration plainly while suppressing arbitrary provider credentials and URLs', () => {
  expect(safeDeliveryError('RESEND_API_KEY must be configured before sending email.')).toBe(
    'Email sending is not configured. Choose a sender in Configuration.',
  );
  const safe = safeDeliveryError(
    'Provider rejected authorization: private-value https://example.test/private-link',
  );
  expect(safe).not.toContain('private-value');
  expect(safe).not.toContain('https://');
});
