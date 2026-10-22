import { AsyncLocalStorage } from 'node:async_hooks';

// Only background readers opt in. Booking/payment commands keep foreground capacity.
const context = new AsyncLocalStorage<{ background: boolean }>();
export const isClockBackgroundWork = () => context.getStore()?.background === true;
export const withClockBackgroundWork = <T>(work: () => Promise<T>): Promise<T> =>
  context.run({ background: true }, work);
