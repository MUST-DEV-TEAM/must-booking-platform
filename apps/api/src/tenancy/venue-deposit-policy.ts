import { BadRequestException } from '@nestjs/common';

export type DepositRule = {
  serviceId: string | null;
  areaId: string | null;
  mode: 'none' | 'per_guest' | 'per_booking';
  amount: string;
  minParty: number;
  freeCancelHours: number;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Exact decimal arithmetic: never multiply currency using floating point. */
export function depositMinor(amount: string): bigint {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(amount))
    throw new BadRequestException('Enter an amount with at most two decimal places.');
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export function depositDecimal(minor: bigint): string {
  return `${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`;
}

export function parseDepositRules(body: unknown): { version: number; rules: DepositRule[] } {
  const input = body as { version?: unknown; rules?: unknown } | null;
  if (
    !input ||
    !Number.isInteger(input.version) ||
    Number(input.version) < 0 ||
    !Array.isArray(input.rules) ||
    input.rules.length > 200
  )
    throw new BadRequestException('Send the deposit rules and their current version.');
  const scopes = new Set<string>();
  const rules = input.rules.map((raw: unknown): DepositRule => {
    if (!raw || typeof raw !== 'object') throw new BadRequestException('Invalid deposit rule.');
    const row = raw as Record<string, unknown>;
    const serviceId =
      typeof row.serviceId === 'string' ? row.serviceId.toLowerCase() : (row.serviceId ?? null);
    const areaId = typeof row.areaId === 'string' ? row.areaId.toLowerCase() : (row.areaId ?? null);
    if ([serviceId, areaId].some((id) => id !== null && (typeof id !== 'string' || !uuid.test(id))))
      throw new BadRequestException('Invalid service or dining area.');
    if (areaId && !serviceId) throw new BadRequestException('An area override needs a service.');
    const scope = `${serviceId}:${areaId}`;
    if (scopes.has(scope)) throw new BadRequestException('Duplicate deposit rule.');
    scopes.add(scope);
    if (!['none', 'per_guest', 'per_booking'].includes(String(row.mode)))
      throw new BadRequestException('Choose no deposit, per guest, or per booking.');
    const mode = row.mode as DepositRule['mode'];
    const minor = depositMinor(typeof row.amount === 'string' ? row.amount.trim() : '');
    if ((mode === 'none' && minor !== 0n) || (mode !== 'none' && minor <= 0n))
      throw new BadRequestException('A deposit must be positive; no deposit must be zero.');
    if (
      !Number.isInteger(row.minParty) ||
      Number(row.minParty) < 1 ||
      Number(row.minParty) > 500 ||
      !Number.isInteger(row.freeCancelHours) ||
      Number(row.freeCancelHours) < 0 ||
      Number(row.freeCancelHours) > 8760
    )
      throw new BadRequestException('Check the minimum party size and cancellation hours.');
    return {
      serviceId: serviceId as string | null,
      areaId: areaId as string | null,
      mode,
      amount: depositDecimal(minor),
      minParty: Number(row.minParty),
      freeCancelHours: Number(row.freeCancelHours),
    };
  });
  return { version: Number(input.version), rules };
}

export function priceDeposit(
  rules: DepositRule[],
  serviceId: string,
  areaId: string,
  partySize: number,
) {
  const rule = rules.find((r) => r.serviceId === serviceId && r.areaId === areaId) ??
    rules.find((r) => r.serviceId === serviceId && r.areaId === null) ??
    rules.find((r) => r.serviceId === null && r.areaId === null) ?? {
      serviceId: null,
      areaId: null,
      mode: 'none' as const,
      amount: '0.00',
      minParty: 1,
      freeCancelHours: 24,
    };
  const total =
    rule.mode === 'none' || partySize < rule.minParty
      ? 0n
      : depositMinor(rule.amount) * BigInt(rule.mode === 'per_guest' ? partySize : 1);
  if (total > 999999999999n)
    throw new BadRequestException('The deposit exceeds the supported amount.');
  return { ...rule, total: depositDecimal(total) };
}
