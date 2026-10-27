import { BadRequestException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';

/** What a guest rates besides the overall score. Order is the order on the page. */
export const REVIEW_CATEGORIES = [
  { key: 'cleanliness', column: 'cleanliness', label: 'Cleanliness' },
  { key: 'staff', column: 'staff', label: 'Staff' },
  { key: 'location', column: 'location', label: 'Location' },
  { key: 'comfort', column: 'comfort', label: 'Comfort' },
  { key: 'food', column: 'food', label: 'Food' },
  { key: 'valueForMoney', column: 'value_for_money', label: 'Value for money' },
] as const;

export type ReviewCategoryKey = (typeof REVIEW_CATEGORIES)[number]['key'];

export const REVIEW_COMMENT_MAX = 2000;
/** The private link stays usable this long after the invitation goes out. */
export const REVIEW_LINK_VALID_DAYS = 60;

export type ReviewSubmission = {
  overall: number;
  categories: Partial<Record<ReviewCategoryKey, number>>;
  comment: string | null;
};

/** A new private link: the token goes in the email, only its hash is stored. */
export function newReviewToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashReviewToken(token) };
}

export function hashReviewToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function score(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5)
    throw new BadRequestException(`${label} must be a score from 1 to 5.`);
  return value;
}

/** Checks what the guest sent. The overall score is required; each aspect and the comment are optional. */
export function parseReviewSubmission(body: unknown): ReviewSubmission {
  const value = (body ?? {}) as Record<string, unknown>;
  const overall = score(value.overall, 'The overall score');
  const given =
    value.categories && typeof value.categories === 'object' && !Array.isArray(value.categories)
      ? (value.categories as Record<string, unknown>)
      : {};
  const known = new Set<string>(REVIEW_CATEGORIES.map((category) => category.key));
  for (const key of Object.keys(given))
    if (!known.has(key)) throw new BadRequestException(`${key} is not something we ask about.`);
  const categories: ReviewSubmission['categories'] = {};
  for (const category of REVIEW_CATEGORIES) {
    const raw = given[category.key];
    if (raw === undefined || raw === null) continue;
    categories[category.key] = score(raw, category.label);
  }
  let comment: string | null = null;
  if (value.comment !== undefined && value.comment !== null) {
    if (typeof value.comment !== 'string')
      throw new BadRequestException('The comment must be text.');
    const trimmed = value.comment.trim();
    if (trimmed.length > REVIEW_COMMENT_MAX)
      throw new BadRequestException(
        `Please keep the comment under ${REVIEW_COMMENT_MAX} characters.`,
      );
    comment = trimmed || null;
  }
  return { overall, categories, comment };
}
