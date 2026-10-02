import { Link } from '@tanstack/react-router';
import { FileQuestion } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';

type ModelMissingProps = { modelKey: string };

/** The URL names a model that doesn't exist (renamed, deleted, or not readable by this person). */
export const ModelMissing = ({ modelKey }: ModelMissingProps) => {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={FileQuestion}
      title={t('content.missingModel.title', { key: modelKey })}
      action={
        <Button asChild variant="outline">
          <Link to="/content">{t('content.missingModel.back')}</Link>
        </Button>
      }
    />
  );
};
