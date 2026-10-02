import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CopyButton } from '@/components/CopyButton';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { cn } from '@/helpers/cn';
import { Panel } from '../Panel';
import { UnsavedChangesGuard } from '../UnsavedChangesGuard';

type SecretRevealProps = {
  /** "Copy your new token". The panel is a region named by it. */
  title: string;
  /** One line: it is shown only once, where to keep it. */
  description: string;
  /** The field label ("Token", "Signing secret"). */
  label: string;
  secret: string;
  /** "I've copied it"; defaults to "I've saved it". */
  dismissLabel?: string;
  onDismiss: () => void;
  /** Extra guidance under the secret (e.g. how to verify signatures). */
  hint?: ReactNode;
  className?: string;
};

/**
 * Shows a new secret exactly once (API tokens, webhook and deployment signing secrets), inline at the top of
 * the page where it was created, never in a URL. It takes focus (its copy button) when it appears, and
 * leaving the page before dismissing it asks first, since the secret can't be shown again.
 */
export const SecretReveal = ({
  title,
  description,
  label,
  secret,
  dismissLabel,
  onDismiss,
  hint,
  className,
}: SecretRevealProps) => {
  const { t } = useTranslation();
  const id = useId();
  const copyRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    copyRef.current?.focus();
  }, []);
  return (
    <Panel title={title} description={description} className={cn('border-success/50', className)}>
      <div className="space-y-4">
        <Field>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <div className="flex gap-2">
            <Input
              id={id}
              readOnly
              value={secret}
              inputSize="sm"
              className="font-mono text-xs"
              onFocus={(event) => event.currentTarget.select()}
            />
            <CopyButton ref={copyRef} value={secret} />
          </div>
        </Field>
        {hint}
        <div className="flex justify-end">
          <Button type="button" onClick={onDismiss}>
            {dismissLabel ?? t('secret.saved')}
          </Button>
        </div>
      </div>
      <UnsavedChangesGuard
        when
        title={t('secret.leaveTitle')}
        description={t('secret.leaveDescription')}
        stayLabel={t('secret.stay')}
        leaveLabel={t('secret.leave')}
      />
    </Panel>
  );
};
