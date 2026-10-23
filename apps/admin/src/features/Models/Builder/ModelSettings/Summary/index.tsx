import { isModelDefinition, entryLayoutOf, routeKeyOf } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/StatusChip';
import { Badge } from '@/components/ui/badge';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { KIND_ICONS, KIND_LABEL_KEYS } from '../../../constants';
import { membershipsOf, ownImplementsOf } from '../../../helpers/interfaces';
import { useModelIndex } from '../../../hooks/useModelIndex';

type SummaryProps = { hasIssues: boolean };

/**
 * The collapsed Model settings in one row: kind, the type it extends, the interfaces it implements, localization,
 * drafts, a form layout, and the plural API ID.
 */
export const Summary = ({ hasIssues }: SummaryProps) => {
  const { t } = useTranslation();
  const draft = useDefinitionDraftStore((state) => state.draft);
  const { index } = useModelIndex();
  if (!draft) {
    return null;
  }
  const KindIcon = KIND_ICONS[draft.kind];
  const parentId = draft.kind === 'collection' ? draft.extends : undefined;
  const nameOf = (id: string) => index.get(id)?.label ?? id;
  const implemented = membershipsOf(index, draft.id, ownImplementsOf(draft)).map(({ interfaceId, via }) =>
    via === undefined
      ? nameOf(interfaceId)
      : t('models.implements.via', { name: nameOf(interfaceId), model: nameOf(via) }),
  );
  const implementsText =
    implemented.length === 0 ? undefined : t('models.implements.summary', { names: implemented.join(', ') });
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
      {implementsText === undefined ? null : (
        <Badge variant="outline" className="max-w-full" title={implementsText}>
          <span className="truncate">{implementsText}</span>
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
