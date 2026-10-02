import { i18next } from '@/app/i18n';
import { describeError } from '@/helpers/describeError';
import { UploadTransferError } from '@/helpers/uploadWithProgress';

/** Why an upload failed, for the queue. Storage refusals (bucket or upload route) get their own message. */
export const describeUploadError = (error: unknown): string => {
  if (error instanceof UploadTransferError) {
    if (error.status === 0) {
      return i18next.t('media.upload.unreachable');
    }
    if (error.status === 413 || /EntityTooLarge/.test(error.body)) {
      return i18next.t('errors.codes.FILE_TOO_LARGE');
    }
    return i18next.t('media.upload.transferFailed', { status: error.status });
  }
  return describeError(error);
};
