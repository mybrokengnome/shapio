import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/constants/auth';
import type en from '@/locales/en/translation.json';

/** Zod messages are translation keys; form fields translate them when they render the error. */
export type ValidationMessageKey = `validation.${keyof typeof en.validation}`;

const message = (key: ValidationMessageKey) => key;

export const requiredText = () => z.string().trim().min(1, message('validation.required'));

export const emailField = () =>
  z
    .string()
    .trim()
    .min(1, message('validation.required'))
    .pipe(z.email(message('validation.email')));

export const newPasswordField = () =>
  z
    .string()
    .min(PASSWORD_MIN_LENGTH, message('validation.passwordTooShort'))
    .max(PASSWORD_MAX_LENGTH, message('validation.passwordTooLong'));

/** Adds a `confirmPassword` that must equal `password`. */
type PasswordPair = { password: string; confirmPassword: string };

export const withPasswordConfirmation = <TShape extends z.ZodRawShape & { password: z.ZodType<string> }>(
  shape: TShape,
) =>
  z
    .object({ ...shape, confirmPassword: z.string() })
    // The generic shape hides the two keys from TypeScript; both are guaranteed by the constraint above.
    .refine(
      (values) =>
        (values as unknown as PasswordPair).confirmPassword === (values as unknown as PasswordPair).password,
      {
        message: message('validation.passwordsDontMatch'),
        path: ['confirmPassword'],
      },
    );

export const isValidationMessageKey = (value: string | undefined): value is ValidationMessageKey =>
  value?.startsWith('validation.') ?? false;
