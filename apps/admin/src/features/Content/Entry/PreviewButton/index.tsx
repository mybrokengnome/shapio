import { Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type PreviewButtonProps = {
  /** The site has a deployment connection with a preview URL. */
  available: boolean;
  /** The preview is on screen. */
  pressed: boolean;
  onToggle: () => void;
};

/**
 * Shows or hides the draft on the site beside the document. Without a connection that has a preview URL it
 * stays visible but explains what's missing.
 */
export const PreviewButton = ({ available, pressed, onToggle }: PreviewButtonProps) => {
  const { t } = useTranslation();
  if (available) {
    return (
      <Button
        type="button"
        variant={pressed ? 'secondary' : 'ghost'}
        size="sm"
        aria-pressed={pressed}
        onClick={onToggle}
      >
        <Eye aria-hidden="true" />
        {t('content.form.preview')}
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-disabled="true"
          aria-description={t('content.form.previewUnavailable')}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
          onClick={(event) => event.preventDefault()}
        >
          <Eye aria-hidden="true" />
          {t('content.form.preview')}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t('content.form.previewUnavailable')}</TooltipContent>
    </Tooltip>
  );
};
