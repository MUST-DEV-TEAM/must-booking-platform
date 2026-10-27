import { describe, expect, it } from 'vitest';

import { hashReviewToken, newReviewToken, parseReviewSubmission } from './guest-review';

describe('parseReviewSubmission', () => {
  it('needs the overall score and nothing else', () => {
    expect(parseReviewSubmission({ overall: 4 })).toEqual({
      overall: 4,
      categories: {},
      comment: null,
    });
  });

  it('keeps the aspects the guest rated and a trimmed comment', () => {
    const review = parseReviewSubmission({
      overall: 5,
      categories: { cleanliness: 5, valueForMoney: 3, food: null },
      comment: '  Lovely stay.  ',
    });
    expect(review.categories).toEqual({ cleanliness: 5, valueForMoney: 3 });
    expect(review.comment).toBe('Lovely stay.');
  });

  it('turns an empty comment into no comment', () => {
    expect(parseReviewSubmission({ overall: 3, comment: '   ' }).comment).toBeNull();
  });

  it('refuses scores outside 1 to 5 and anything that is not a whole number', () => {
    for (const overall of [0, 6, 3.5, '4', null, undefined])
      expect(() => parseReviewSubmission({ overall })).toThrow(/overall score/);
    expect(() => parseReviewSubmission({ overall: 4, categories: { staff: 9 } })).toThrow(/Staff/);
  });

  it('refuses an aspect we do not ask about and an over-long comment', () => {
    expect(() => parseReviewSubmission({ overall: 4, categories: { parking: 5 } })).toThrow(
      /not something we ask/,
    );
    expect(() => parseReviewSubmission({ overall: 4, comment: 'x'.repeat(2001) })).toThrow(
      /under 2000/,
    );
  });
});

describe('review links', () => {
  it('gives a different private link each time and stores only its hash', () => {
    const a = newReviewToken();
    const b = newReviewToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token.length).toBeGreaterThanOrEqual(40);
    expect(a.hash).toBe(hashReviewToken(a.token));
    expect(a.hash).not.toContain(a.token);
  });
});
