import type { ModelDefinition } from '@shapio/schema';
import { Link } from '@tanstack/react-router';
import { ListPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';

type NoFieldsProps = { model: ModelDefinition; canManageSchema: boolean };

/** A content type without fields has nothing to write yet: point people who can add fields to Structure. */
export const NoFields = ({ model, canManageSchema }: NoFieldsProps) => {
  const { t } = useTranslation();
  return (
    <EmptyState
      size="panel"
      icon={ListPlus}
      title={t('entry.noFields.title')}
      description={canManageSchema ? undefined : t('entry.noFields.ask')}
      action={
        canManageSchema ? (
          <Button asChild>
            <Link to="/content/$modelKey" params={{ modelKey: model.apiKey }} search={{ tab: 'structure' }}>
              {t('entry.noFields.addFields')}
            </Link>
          </Button>
        ) : undefined
      }
    />
  );
};
