import { toast } from 'sonner';
import { describeError } from './describeError';

/** Logs a failure with context to the browser console. */
export const logError = (error: unknown, context: string) => {
  // eslint-disable-next-line no-console -- the browser console is the admin's log sink
  console.error(`[shapio-admin] ${context}`, error);
};

/** Logs a failure and tells the user with a toast (never swallow errors). */
export const reportError = (error: unknown, context: string) => {
  logError(error, context);
  const message = describeError(error);
  toast.error(message, { id: `${context}:${message}` });
};
