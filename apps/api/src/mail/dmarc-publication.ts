import { Resolver } from 'node:dns/promises';
import { smtpHostname } from './smtp-network-policy';

export type DmarcPublication = {
  name: string;
  type: 'TXT';
  state: 'published' | 'absent' | 'invalid' | 'unknown';
  values: string[];
  observedAt: string;
  message: string;
};

/** Reports TXT publication at the exact sender name, never effective policy or delivery alignment. */
export async function readDmarcPublication(
  domain: string,
  lookup?: (name: string) => Promise<string[][]>,
): Promise<DmarcPublication> {
  const name = `_dmarc.${smtpHostname(domain)}`;
  const base = { name, type: 'TXT' as const, observedAt: new Date().toISOString() };
  // Public resolvers prevent tenant-controlled CNAMEs querying a company's private DNS zones.
  const resolver = lookup ? null : new Resolver({ timeout: 1500, tries: 1 });
  resolver?.setServers(['1.1.1.1', '8.8.8.8']);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answers = await Promise.race([
      lookup ? lookup(name + '.') : resolver!.resolveTxt(name + '.'),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          resolver?.cancel();
          reject(new Error('DNS deadline'));
        }, 4000);
      }),
    ]);
    if (
      answers.length > 50 ||
      answers.some(
        (row) =>
          !Array.isArray(row) || row.length > 32 || row.some((part) => typeof part !== 'string'),
      )
    )
      throw new Error('DNS response limit');
    const values = answers
      .map((parts) => parts.join(''))
      .filter((value) => /^v=DMARC1(?:;|$)/i.test(value.trim()));
    if (values.some((value) => Buffer.byteLength(value) > 8192) || values.length > 5)
      throw new Error('DNS response limit');
    if (!values.length)
      return {
        ...base,
        state: 'absent',
        values: [],
        message:
          'No DMARC TXT was found at this exact name. A parent-domain policy may apply; check DNS guidance before adding a policy.',
      };
    const tags = values[0]
      .split(';')
      .map((tag) => tag.trim())
      .filter(Boolean);
    const policy = tags.filter((tag) => /^p=/i.test(tag));
    const duplicate =
      new Set(tags.map((tag) => tag.split('=')[0].toLowerCase())).size !== tags.length;
    const reportingOnly =
      policy.length === 0 && tags.some((tag) => /^rua=mailto:[^\s;]+$/i.test(tag));
    const valid =
      values.length === 1 &&
      !duplicate &&
      (reportingOnly || (policy.length === 1 && /^p=(none|quarantine|reject)$/i.test(policy[0])));
    return {
      ...base,
      state: valid ? 'published' : 'invalid',
      values,
      message: valid
        ? 'A DMARC policy is published at this exact name. This does not verify message alignment or delivery.'
        : 'The DMARC records at this name are conflicting or lack one valid policy. Review them in DNS; do not add a duplicate.',
    };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
    if (code === 'ENODATA' || code === 'ENOTFOUND')
      return {
        ...base,
        state: 'absent',
        values: [],
        message:
          'No DMARC TXT was found at this exact name. A parent-domain policy may apply; check DNS guidance before adding a policy.',
      };
    return {
      ...base,
      state: 'unknown',
      values: [],
      message:
        'Public DNS could not be checked. Try again or review the exact name in your DNS provider.',
    };
  } finally {
    if (timer) clearTimeout(timer);
    resolver?.cancel();
  }
}
