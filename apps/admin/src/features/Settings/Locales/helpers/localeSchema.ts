import { LOCALE_CODE_PATTERN } from '@shapio/schema';
import { z } from 'zod';
import { requiredText } from '@/helpers/validation';

const MAX_CODE_LENGTH = 35;

/**
 * `existing`: the codes already in use. A code that differs from one only in case (`FR` beside `fr`) is
 * refused as taken, not as badly written: codes are compared case-insensitively.
 */
export const localeSchemaFor = (existing: readonly string[]) =>
  z.object({
    code: z
      .string()
      .trim()
      .min(1, 'validation.required')
      .superRefine((code, context) => {
        if (existing.includes(code.toLowerCase())) {
          context.addIssue({ code: 'custom', message: 'validation.localeExists' });
        } else if (code.length > MAX_CODE_LENGTH || !LOCALE_CODE_PATTERN.test(code)) {
          context.addIssue({ code: 'custom', message: 'validation.localeCode' });
        }
      }),
    label: requiredText(),
    fallbacks: z.array(z.string()),
  });

export type LocaleValues = z.infer<ReturnType<typeof localeSchemaFor>>;
