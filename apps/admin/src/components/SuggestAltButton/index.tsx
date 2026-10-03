import { useTranslation } from 'react-i18next';
import { useAssistEnabled, useSuggestAltText } from '@/api/assist';
import { AssistButton } from '@/components/AssistButton';
import { AssistError } from '@/components/AssistError';
import { cn } from '@/helpers/cn';

type SuggestAltButtonProps = {
  assetId: string | undefined;
  /** The asset's MIME type: only images get a suggestion. */
  mimeType: string | undefined;
  /** The language to write in (the entry's locale); the default locale when omitted. */
  locale?: string | null;
  /** Receives the proposal: the caller puts it in its alt input, and the person saves. */
  onSuggest: (alt: string) => void;
  disabled?: boolean;
  className?: string;
};

/** "Suggest alt text" beside an alt input (rich-text image, media field, cover, library). Hidden when assist is off. */
export const SuggestAltButton = ({
  assetId,
  mimeType,
  locale,
  onSuggest,
  disabled = false,
  className,
}: SuggestAltButtonProps) => {
  const { t } = useTranslation();
  const enabled = useAssistEnabled();
  const suggest = useSuggestAltText();
  if (!enabled || !assetId || !mimeType?.startsWith('image/')) {
    return null;
  }
  return (
    <div className={cn('flex flex-col items-start gap-1', className)}>
      <AssistButton
        pending={suggest.isPending}
        pendingLabel={t('assist.altText.pending')}
        disabled={disabled}
        onClick={() =>
          suggest.mutate(
            { assetId, ...(locale ? { locale } : {}) },
            { onSuccess: (result) => onSuggest(result.alt) },
          )
        }
      >
        {t('assist.altText.suggest')}
      </AssistButton>
      <AssistError error={suggest.error} />
    </div>
  );
};
