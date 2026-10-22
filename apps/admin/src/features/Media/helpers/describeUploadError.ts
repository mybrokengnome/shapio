import { apiBaseUrl } from '@/api/client';
import { isShapioErrorText } from '@/api/errors';
import { i18next } from '@/app/i18n';
import { describeError } from '@/helpers/describeError';
import { UploadTransferError } from '@/helpers/uploadWithProgress';

/**
 * Shapio's own upload route (local storage) answered 403 with something other than Shapio's error shape: a
 * firewall or proxy in front of the server refused the bytes. A bucket's 403 is the bucket's own answer.
 */
const isBlockedTransfer = (error: UploadTransferError) =>
  error.status === 403 && error.url.startsWith(apiBaseUrl()) && !isShapioErrorText(error.body);

/** Why an upload failed, for the queue. Storage refusals (bucket or upload route) get their own message. */
export const describeUploadError = (error: unknown): string => {
  if (error instanceof UploadTransferError) {
    if (error.status === 0) {
      return i18next.t('media.upload.unreachable');
    }
    if (isBlockedTransfer(error)) {
      return i18next.t('common.blockedRequest');
    }
    if (error.status === 413 || /EntityTooLarge/.test(error.body)) {
      return i18next.t('errors.codes.FILE_TOO_LARGE');
    }
    return i18next.t('media.upload.transferFailed', { status: error.status });
  }
  return describeError(error);
};
