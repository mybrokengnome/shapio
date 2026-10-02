import { MousePointerClick, Shapes } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';

type NoFieldSelectedProps = { hasFields: boolean };

/** The properties column before a field is chosen (xl only: below it, the field list is right above). */
export const NoFieldSelected = ({ hasFields }: NoFieldSelectedProps) => {
  const { t } = useTranslation();
  return (
    <Panel aria-label={t('models.builder.propertiesLabel')} className="hidden xl:block">
      {hasFields ? (
        <EmptyState size="panel" icon={MousePointerClick} title={t('models.builder.selectField')} />
      ) : (
        <EmptyState size="panel" icon={Shapes} title={t('models.builder.startTitle')} />
      )}
    </Panel>
  );
};
