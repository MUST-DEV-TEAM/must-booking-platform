import { ClockFinancialDataError } from './clock-financial.service';

/**
 * What may be logged about a failure: the kind of error, its code and the rule that refused a row. Never the
 * message itself, because a database message can quote the failing row, which holds guest details.
 */
export const errorText = (error: unknown) => {
  if (!(error instanceof Error)) return 'unknown error';
  const code = (error as { code?: unknown }).code;
  const dbCode = (error as { meta?: { code?: unknown } }).meta?.code;
  const constraint = /constraint "([A-Za-z0-9_]{1,80})"/.exec(error.message)?.[1];
  return [
    error.name,
    typeof code === 'string' ? `code ${code}` : null,
    typeof dbCode === 'string' ? `database code ${dbCode}` : null,
    constraint ? `rule ${constraint}` : null,
    // A financial refusal carries fixed text that never quotes Clock or guest data, so the cause can be logged.
    error instanceof ClockFinancialDataError ? error.message : null,
  ]
    .filter(Boolean)
    .join(', ');
};

export const FAILURE_REASON_MAX_LENGTH = 300;

/**
 * The reason saved on a failed webhook event (`provider_events.last_error`) so that staff can tell a timeout
 * from a refused row without the logs. It holds the error name, its code, the first line of the message with
 * email addresses, runs of 6 or more digits and URL query strings masked, and at most 300 characters. Never the
 * payload, which can hold guest details. A database message that quotes a row is cut to its first line and
 * masked, which is why only the first line is kept.
 */
export const failureReason = (error: unknown): string => {
  const head = errorText(error);
  const message = error instanceof Error ? error.message : '';
  const firstLine =
    message
      .split(/\r?\n/, 1)[0]
      ?.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, '[email]')
      .replace(/(https?:\/\/[^\s?#]*)[?#]\S*/gi, '$1')
      .replace(/\d{6,}/g, '[number]')
      .trim() ?? '';
  const reason = firstLine && !head.includes(firstLine) ? `${head}: ${firstLine}` : head;
  return reason.slice(0, FAILURE_REASON_MAX_LENGTH);
};
