import { ShapioApiError } from '@shapio/client';
import { isBlockedRequest } from '@/api/errors';
import { i18next } from '@/app/i18n';
import en from '@/locales/en/translation.json';

type KnownErrorCode = keyof typeof en.errors.codes;

const isKnownErrorCode = (code: string): code is KnownErrorCode => Object.hasOwn(en.errors.codes, code);

/** The translated sentence for a server error code, or undefined when the code has none. */
export const knownErrorMessage = (code: string): string | undefined =>
  isKnownErrorCode(code) ? i18next.t(`errors.codes.${code}`) : undefined;

/**
 * A human-readable, translated message for a failed request. Known server error codes have their own
 * translation (`errors.codes.<CODE>`), and a 403 from a firewall or proxy says so; otherwise the server's message is shown, which is more useful than a
 * generic one.
 */
export const describeError = (error: unknown): string => {
  if (isBlockedRequest(error)) {
    return i18next.t('common.blockedRequest');
  }
  if (error instanceof ShapioApiError) {
    return isKnownErrorCode(error.code) ? i18next.t(`errors.codes.${error.code}`) : error.message;
  }
  if (error instanceof TypeError) {
    return i18next.t('errors.network');
  }
  return i18next.t('errors.unexpected');
};
