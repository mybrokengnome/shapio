import { useTranslation } from 'react-i18next';
import { FieldError } from '@/components/ui/field';
import { isValidationMessageKey } from '@/helpers/validation';

type FormFieldErrorProps = { id?: string; message: string | undefined };

/** A field's inline error. Client-side messages are translation keys; server messages arrive translated. */
export const FormFieldError = ({ id, message }: FormFieldErrorProps) => {
  const { t } = useTranslation();
  if (!message) {
    return null;
  }
  return <FieldError id={id}>{isValidationMessageKey(message) ? t(message) : message}</FieldError>;
};
