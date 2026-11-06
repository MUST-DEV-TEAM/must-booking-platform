import { describe, expect, it } from 'vitest';

import { errorText } from './clock-background-sync.service';
import { ClockFinancialDataError } from './clock-financial.service';

describe('what a failed Clock sync job writes to the log', () => {
  it('names the cause of a financial refusal, whose text is fixed and holds no guest data', () => {
    expect(errorText(new ClockFinancialDataError('Clock payment amount is incomplete.'))).toBe(
      'ClockFinancialDataError, Clock payment amount is incomplete.',
    );
  });

  it('still never writes the message of any other error, which can quote a guest row', () => {
    expect(errorText(new Error('duplicate key value violates unique constraint "x" (a@b.c)'))).toBe(
      'Error, rule x',
    );
  });
});
