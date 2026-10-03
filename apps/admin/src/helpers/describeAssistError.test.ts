import { ShapioApiError } from '@shapio/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { initI18n } from '@/app/i18n';
import en from '@/locales/en/translation.json';
import { describeAssistError, describeAssistErrorCode } from './describeAssistError';

const apiError = (status: number, code: string, message = 'from the server') =>
  new ShapioApiError(status, { error: { code, message } });

beforeAll(async () => {
  await initI18n();
});

describe('describeAssistError', () => {
  it('names the per-actor rate limit', () => {
    expect(describeAssistError(apiError(429, 'RATE_LIMITED'))).toBe(en.assist.errors.rateLimited);
  });

  it('translates assist codes and falls back to the server message', () => {
    expect(describeAssistError(apiError(503, 'ASSIST_PROVIDER_BUSY'))).toBe(
      en.errors.codes.ASSIST_PROVIDER_BUSY,
    );
    expect(describeAssistError(apiError(400, 'SOMETHING_NEW', 'Field is odd'))).toBe('Field is odd');
  });

  it('describes a failed run by its code', () => {
    expect(describeAssistErrorCode('ASSIST_DECLINED')).toBe(en.errors.codes.ASSIST_DECLINED);
    expect(describeAssistErrorCode('INTERNAL_ERROR')).toBe(en.assist.errors.runFailed);
  });
});
