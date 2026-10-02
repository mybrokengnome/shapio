import { Check, Copy } from 'lucide-react';
import { useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { reportError } from '@/helpers/reportError';

type CopyButtonProps = {
  value: string;
  /** For a caller that moves focus to the button (SecretReveal on mount). */
  ref?: Ref<HTMLButtonElement>;
};

const COPIED_RESET_MS = 2000;

export const CopyButton = ({ value, ref }: CopyButtonProps) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), COPIED_RESET_MS);
    } catch (error) {
      reportError(error, 'copy to clipboard');
    }
  };
  return (
    <Button ref={ref} type="button" variant="outline" onClick={() => void copy()}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      <span aria-live="polite">{copied ? t('common.copied') : t('common.copy')}</span>
    </Button>
  );
};
