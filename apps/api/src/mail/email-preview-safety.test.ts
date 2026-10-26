import { describe, expect, it } from 'vitest';
import { safeEmailPreview } from './email-preview-safety';
import { currentMailAttempt, withMailAttempt } from './mail-attempt-context';

describe('retained email preview safety', () => {
  it('keeps readable tables but removes action URLs, network resources and active HTML', () => {
    const result = safeEmailPreview({
      subject: 'Stay https://hotel.test/cancel?token=secret',
      text: 'Guest stay\nhttps://hotel.test/cancel?token=secret',
      html: `<title>Private inbox subject</title><meta http-equiv="refresh" content="0;url=https://tracker.test"><base href="https://tracker.test"><script>alert('secret')</script><style>body{background:url(https://tracker.test)}</style><svg><a href="https://tracker.test">hidden</a></svg><form action="https://hotel.test/cancel"><input name="token" value="secret"></form><img src="https://tracker.test/open"><a href="https://hotel.test/cancel?token=secret">Cancel booking</a><table style="width:100%;background-image:url(https://tracker.test);position:fixed"><tr><td onclick="alert(1)">Recorded rate 120.00 EUR</td></tr></table><p>https&#x3a;//hotel.test/cancel?token=secret</p>`,
    });
    expect(result.html).toContain('<table style="width:100%">');
    expect(result.html).toContain('Recorded rate 120.00 EUR');
    for (const output of [result.subject, result.html, result.text]) {
      expect(output).not.toContain('token=secret');
      expect(output).not.toContain('tracker.test');
    }
    for (const forbidden of [
      'Private inbox subject',
      '<script',
      '<form',
      '<img',
      '<svg',
      'href=',
      'onclick=',
      'background-image',
      'position:fixed',
      'http-equiv="refresh"',
    ])
      expect(result.html).not.toContain(forbidden);
    expect(result.html).toContain("default-src 'none'");
    expect(result.text).toBe('Guest stay\n[link removed]');
  });
  it('retains a non-interactive button appearance while stripping its signed URL', () => {
    const result = safeEmailPreview({
      subject: 'Stay',
      text: 'Open reservation',
      html: '<table><tr><td style="border-radius:6px;background-color:#215448"><a href="https://hotel.test/manage?token=secret" style="display:block;padding:14px 26px;color:#ffffff">Open reservation</a></td></tr></table>',
    });
    expect(result.html).toContain('border-radius:6px');
    expect(result.html).toContain('<span');
    expect(result.html).toContain('Open reservation');
    expect(result.html).not.toContain('token=');
    expect(result.html).not.toContain('href=');
  });
  it('isolates simultaneous message identities and removes context after the attempt', async () => {
    const result = await Promise.all(
      ['first', 'second'].map((messageId) =>
        withMailAttempt(
          {
            messageId,
            tenantId: 'tenant-' + messageId,
            propertyId: 'property-' + messageId,
            sensitive: false,
          },
          async () => {
            await new Promise((resolve) => setTimeout(resolve, messageId === 'first' ? 10 : 1));
            return currentMailAttempt();
          },
        ),
      ),
    );
    expect(result.map((context) => context?.messageId)).toEqual(['first', 'second']);
    expect(result.map((context) => context?.propertyId)).toEqual([
      'property-first',
      'property-second',
    ]);
    expect(currentMailAttempt()).toBeUndefined();
  });
});
