import { isModelDefinition, entryLayoutOf, routeKeyOf } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/StatusChip';
import { Badge } from '@/components/ui/badge';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { KIND_ICONS, KIND_LABEL_KEYS } from '../../../constants';
import { useModelIndex } from '../../../hooks/useModelIndex';

type SummaryProps = { hasIssues: boolean };

/** The collapsed Model settings: kind, localization, drafts, a form layout, and the plural API ID, in one row. */
export const Summary = ({ hasIssues }: SummaryProps) => {
  const { t } = useTranslation();
  const draft = useDefinitionDraftStore((state) => state.draft);
  const { index } = useModelIndex();
  if (!draft) {
    return null;
  }
  const KindIcon = KIND_ICONS[draft.kind];
  const parentId = draft.kind === 'collection' ? draft.extends : undefined;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="outline">
        <KindIcon aria-hidden="true" />
        {t(KIND_LABEL_KEYS[draft.kind])}
      </Badge>
      {parentId === undefined ? null : (
        <Badge variant="outline">
          {t('models.inheritance.extendsSummary', { model: index.get(parentId)?.label ?? parentId })}
        </Badge>
      )}
      {!isModelDefinition(draft) ? null : (
        <>
          <Badge variant="outline">
            {t(draft.localized ? 'models.builder.summaryLocalized' : 'models.builder.summaryNotLocalized')}
          </Badge>
          <Badge variant="outline">
            {t(draft.draftAndPublish ? 'models.builder.summaryDrafts' : 'models.builder.summaryNoDrafts')}
          </Badge>
          {entryLayoutOf(draft) === 'form' ? (
            <Badge variant="outline">{t('models.builder.summaryForm')}</Badge>
          ) : null}
        </>
      )}
      {draft.kind === 'collection' ? (
        <Badge variant="outline" className="font-mono font-medium">
          <span className="sr-only">{t('models.pluralApiKey')} </span>
          {routeKeyOf(draft)}
        </Badge>
      ) : null}
      {hasIssues ? <StatusChip tone="danger" size="sm" label={t('models.builder.hasProblems')} /> : null}
    </div>
  );
};
