import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { VISUAL_EDITING_DOCS_URL } from '@/constants/publishing';
import { ExternalLink } from '@/features/Publishing/ExternalLink';

/** Shown in the pane when the framed page never said it runs @shapio/visual. */
export const SdkNotice = () => {
  const { t } = useTranslation();
  return (
    <Alert variant="info" className="rounded-none border-x-0 border-t-0">
      <Info aria-hidden="true" />
      <AlertTitle>{t('entry.preview.sdkMissingTitle')}</AlertTitle>
      <AlertDescription>
        <p>
          {t('entry.preview.sdkMissingDescription')}{' '}
          <ExternalLink href={VISUAL_EDITING_DOCS_URL}>{t('entry.preview.setupGuide')}</ExternalLink>
        </p>
      </AlertDescription>
    </Alert>
  );
};
