import { ID_DOCUMENT_CHOICES } from './policy-rules';

/** What guests will read about the hotel's policies, built from the form as it stands (settings plan, S5). */
export type PolicyPreviewLanguage = 'en' | 'sq';

type Values = Record<string, unknown>;

const text = (values: Values, key: string) => {
  const v = values[key];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
};

const DOCUMENT_NAMES: Record<string, Record<PolicyPreviewLanguage, string>> = {
  passport: { en: 'passport', sq: 'pasaportë' },
  national_id: { en: 'national ID card', sq: 'letërnjoftim' },
  driving_licence: { en: 'driving licence', sq: 'patentë shoferi' },
  residence_permit: { en: 'residence permit', sq: 'leje qëndrimi' },
};

function money(amount: string, currency: string, language: PolicyPreviewLanguage) {
  const value = Number(amount);
  try {
    return new Intl.NumberFormat(language === 'sq' ? 'sq-AL' : 'en-GB', {
      style: 'currency',
      currency: currency || 'EUR',
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function policyPreviewLines(
  values: Values,
  times: { checkInTime?: string | null; checkOutTime?: string | null },
  currency: string,
  language: PolicyPreviewLanguage,
): string[] {
  const en = language === 'en';
  const out: string[] = [];
  const pick = (a: string, b: string) => (en ? a : b);
  const price = (key: string) => {
    const v = text(values, key);
    return v ? money(v, currency, language) : null;
  };

  const inFrom = times.checkInTime || null;
  const inUntil = text(values, 'checkInUntil');
  if (inFrom)
    out.push(
      inUntil
        ? pick(
            `Check-in from ${inFrom} until ${inUntil}.`,
            `Hyrja nga ora ${inFrom} deri në ${inUntil}.`,
          )
        : pick(`Check-in from ${inFrom}.`, `Hyrja nga ora ${inFrom}.`),
    );
  const outBy = times.checkOutTime || null;
  const outFrom = text(values, 'checkOutFrom');
  if (outBy)
    out.push(
      outFrom
        ? pick(
            `Check-out from ${outFrom} until ${outBy}.`,
            `Dalja nga ora ${outFrom} deri në ${outBy}.`,
          )
        : pick(`Check-out by ${outBy}.`, `Dalja deri në orën ${outBy}.`),
    );
  const late = text(values, 'lateArrivalInstructions');
  if (late) out.push(late);

  for (const [prefix, early] of [
    ['earlyCheckIn', true],
    ['lateCheckOut', false],
  ] as const) {
    const policy = text(values, `${prefix}Policy`) ?? 'not_offered';
    const until = text(values, `${prefix}Until`);
    const note = text(values, `${prefix}Note`);
    if (policy === 'on_request')
      out.push(
        early
          ? pick(
              'Early check-in is available on request.',
              'Hyrja e hershme është e mundur me kërkesë.',
            )
          : pick(
              'Late check-out is available on request.',
              'Dalja e vonuar është e mundur me kërkesë.',
            ),
      );
    else if (policy === 'free_until' && until)
      out.push(
        early
          ? pick(
              `Early check-in is free until ${until}.`,
              `Hyrja e hershme është falas deri në ${until}.`,
            )
          : pick(
              `Late check-out is free until ${until}.`,
              `Dalja e vonuar është falas deri në ${until}.`,
            ),
      );
    if (policy !== 'not_offered' && note) out.push(note);
  }

  for (const [prefix, en1, sq1] of [
    ['cots', 'Cots', 'Shtretërit për fëmijë'],
    ['extraBeds', 'Extra beds', 'Shtretërit shtesë'],
  ] as const) {
    const policy = text(values, `${prefix}Policy`) ?? 'not_available';
    const max = text(values, `${prefix}Max`);
    const per = max ? pick(` (up to ${max} per room)`, ` (deri në ${max} për dhomë)`) : '';
    if (policy === 'free') out.push(pick(`${en1} are free${per}.`, `${sq1} janë falas${per}.`));
    else if (policy === 'paid') {
      const fee = price(`${prefix}Fee`);
      if (fee)
        out.push(
          pick(`${en1} cost ${fee} per night${per}.`, `${sq1} kushtojnë ${fee} në natë${per}.`),
        );
    }
  }

  const children = text(values, 'childrenPolicy');
  if (children) {
    out.push(
      children === 'allowed'
        ? pick('Children are welcome.', 'Fëmijët janë të mirëpritur.')
        : children === 'on_request'
          ? pick('Children are welcome on request.', 'Fëmijët pranohen me kërkesë.')
          : pick('Children are not allowed.', 'Fëmijët nuk pranohen.'),
    );
    const note = text(values, 'childrenPolicyNote');
    if (note) out.push(note);
  }

  const pets = text(values, 'petsPolicy');
  if (pets) {
    if (pets === 'not_allowed')
      out.push(pick('Pets are not allowed.', 'Kafshët shtëpiake nuk lejohen.'));
    else {
      const feeType = text(values, 'petsFeeType') ?? 'free';
      const fee = price('petsFee');
      const cost =
        feeType === 'per_night' && fee
          ? pick(` for ${fee} per night`, ` për ${fee} në natë`)
          : feeType === 'per_stay' && fee
            ? pick(` for ${fee} per stay`, ` për ${fee} për qëndrim`)
            : pick(' free of charge', ' falas');
      const max = text(values, 'petsMax');
      const per = max ? pick(` (up to ${max} per room)`, ` (deri në ${max} për dhomë)`) : '';
      out.push(
        pets === 'allowed'
          ? pick(`Pets are allowed${cost}${per}.`, `Kafshët shtëpiake lejohen${cost}${per}.`)
          : pick(
              `Pets are allowed on request${cost}${per}.`,
              `Kafshët shtëpiake lejohen me kërkesë${cost}${per}.`,
            ),
      );
    }
    const note = text(values, 'petsPolicyNote');
    if (note) out.push(note);
    if (pets !== 'not_allowed')
      out.push(
        pick(
          'Assistance animals are always welcome.',
          'Kafshët ndihmëse janë gjithmonë të mirëpritura.',
        ),
      );
  }

  const smoking = text(values, 'smokingPolicy');
  if (smoking)
    out.push(
      smoking === 'allowed'
        ? pick('Smoking is allowed.', 'Duhani lejohet.')
        : smoking === 'designated_areas'
          ? pick(
              'Smoking is allowed in designated areas only.',
              'Duhani lejohet vetëm në zonat e caktuara.',
            )
          : pick('Smoking is not allowed.', 'Duhani nuk lejohet.'),
    );
  const parties = text(values, 'partiesPolicy');
  if (parties)
    out.push(
      parties === 'allowed'
        ? pick('Parties and events are allowed.', 'Festat dhe ngjarjet lejohen.')
        : parties === 'on_request'
          ? pick(
              'Parties and events are allowed on request.',
              'Festat dhe ngjarjet lejohen me kërkesë.',
            )
          : pick('Parties and events are not allowed.', 'Festat dhe ngjarjet nuk lejohen.'),
    );
  const quietFrom = text(values, 'quietHoursFrom');
  const quietTo = text(values, 'quietHoursTo');
  if (quietFrom && quietTo)
    out.push(
      pick(
        `Quiet hours: ${quietFrom} to ${quietTo}.`,
        `Orët e qetësisë: ${quietFrom} - ${quietTo}.`,
      ),
    );

  const id = text(values, 'idAtArrival') ?? 'not_required';
  const docs = (Array.isArray(values.idDocuments) ? (values.idDocuments as string[]) : [])
    .filter((d) => ID_DOCUMENT_CHOICES.some((c) => c.value === d))
    .map((d) => DOCUMENT_NAMES[d]?.[language] ?? d);
  if (id !== 'not_required' && docs.length) {
    const list = docs.join(', ');
    out.push(
      id === 'all_adults'
        ? pick(
            `All adults must show one of these at arrival: ${list}.`,
            `Të gjithë të rriturit duhet të tregojnë një nga këto në mbërritje: ${list}.`,
          )
        : pick(
            `The main guest must show one of these at arrival: ${list}.`,
            `Mysafiri kryesor duhet të tregojë një nga këto në mbërritje: ${list}.`,
          ),
    );
  }

  const deposit = price('damageDepositAmount');
  const method = text(values, 'damageDepositMethod');
  const days = text(values, 'damageDepositRefundDays');
  if (deposit && method && days)
    out.push(
      pick(
        `A damage deposit of ${deposit} is taken ${method === 'cash' ? 'in cash' : 'by card'} at the hotel and refunded within ${days} days.`,
        `Një depozitë dëmtimi prej ${deposit} merret ${method === 'cash' ? 'me para në dorë' : 'me kartë'} në hotel dhe kthehet brenda ${days} ditësh.`,
      ),
    );
  const other = text(values, 'otherHouseRules');
  if (other) out.push(other);
  return out;
}
