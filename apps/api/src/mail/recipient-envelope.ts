import { MailDeliveryError } from './mail-delivery-error';

export type RecipientChannel = 'TO' | 'CC' | 'BCC';
export type RecipientEnvelope = { to: string[]; cc: string[]; bcc: string[] };
export type RoutedRecipient = { email: string; channel?: RecipientChannel };
const channels = ['TO', 'CC', 'BCC'] as const;
/** Resolve overlap before preparing headers: TO wins over CC, then BCC. */
export function deduplicateRecipients<T extends RoutedRecipient>(rows: T[]): T[] {
  const seen = new Set<string>();
  return [...rows]
    .sort((a, b) => channels.indexOf(a.channel ?? 'TO') - channels.indexOf(b.channel ?? 'TO'))
    .filter((row) => {
      const key = row.email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
/** Server-created staff routing; never apply it to account/security or guest mail. */
export function recipientEnvelope(rows: RoutedRecipient[]): RecipientEnvelope {
  const recipients = deduplicateRecipients(rows);
  if (!recipients.length || recipients.length > 100)
    throw new MailDeliveryError('Choose between 1 and 100 resolved staff recipients.', false);
  const envelope: RecipientEnvelope = { to: [], cc: [], bcc: [] };
  for (const row of recipients) {
    if (
      row.email.length > 320 ||
      !/^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(row.email)
    )
      throw new MailDeliveryError('A resolved recipient address is invalid.', false);
    envelope[(row.channel ?? 'TO').toLowerCase() as 'to' | 'cc' | 'bcc'].push(
      row.email.toLowerCase(),
    );
  }
  if (!envelope.to.length)
    throw new MailDeliveryError(
      'Choose at least one available To recipient for the staff email.',
      false,
    );
  return envelope;
}
export function envelopeAddresses(envelope: RecipientEnvelope): string[] {
  return [...envelope.to, ...envelope.cc, ...envelope.bcc];
}
