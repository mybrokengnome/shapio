import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { FormTextField } from '@/components/FormTextField';
import { SubmitButton } from '@/components/SubmitButton';
import { FieldGroup } from '@/components/ui/field';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useResumeSessionForm } from './hooks/useResumeSessionForm';

type ResumeSessionProps = {
  /** The signed-in admin's email: the same account signs in again, so the page never changes hands. */
  email: string;
};

/**
 * Sign in again without leaving the page, after the session ended over unsaved edits. Non-modal and
 * without a close button: the page stays usable beside it (the edits can be read, copied or kept typing)
 * and it goes away once the password is accepted, when failed saves run again.
 */
export const ResumeSession = ({ email }: ResumeSessionProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, resume } = useResumeSessionForm(email);
  return (
    <Sheet open modal={false}>
      <SheetContent nonModal size="sm" showCloseButton={false}>
        <SheetHeader>
          <SheetTitle>{t('sessionEnded.title')}</SheetTitle>
          <SheetDescription>{t('sessionEnded.description')}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <form noValidate onSubmit={(event) => void onSubmit(event)}>
            <FieldGroup>
              <p className="text-sm">{t('sessionEnded.account', { email })}</p>
              <FormTextField
                control={form.control}
                name="password"
                label={t('auth.password')}
                type="password"
                autoComplete="current-password"
              />
              <FormError error={resume.error} />
              <SubmitButton
                pending={resume.isPending}
                pendingLabel={t('login.submitting')}
                className="w-full"
              >
                {t('login.submit')}
              </SubmitButton>
            </FieldGroup>
          </form>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
};
