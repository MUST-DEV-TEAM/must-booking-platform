/** An address shown to a guest without giving it away: "ada@icloud.com" becomes "a***@icloud.com". */
export function maskEmail(email: string | null | undefined): string | null {
  const [local, domain] = (email ?? '').trim().split('@');
  if (!local || !domain) return null;
  return `${local.slice(0, 1)}***@${domain}`;
}
