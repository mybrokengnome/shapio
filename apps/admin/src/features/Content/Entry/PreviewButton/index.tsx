import { Eye } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Preview of the draft on the site. Placeholder until preview connections exist (package H wires it to a
 * deployment connection's URL template and a scoped preview token).
 */
export const PreviewButton = () => {
  const { t } = useTranslation();
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
