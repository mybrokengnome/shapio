import { SORT_DIRECTIONS, type SchemaDefinition, type ValidationIssue } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { titleFieldCandidates } from '../../../helpers/display';
import { withKey } from '../../../helpers/draft';
import { issuesUnder } from '../../../helpers/issues';
import { ChoicesControl } from '../../controls/ChoicesControl';
import { SelectControl } from '../../controls/SelectControl';
import { DocumentLayout } from './DocumentLayout';

type DisplayProps = { definition: SchemaDefinition; issues: readonly ValidationIssue[]; disabled: boolean };

const DIRECTION_LABEL_KEYS = {
  asc: 'models.builder.sortAscending',
  desc: 'models.builder.sortDescending',
} as const;

/** How entries are labelled, listed and laid out: title, order, list columns and the entry document. */
export const Display = ({ definition, issues, disabled }: DisplayProps) => {
  const { t } = useTranslation();
  const update = useDefinitionDraftStore((state) => state.update);
  const setDisplay = (key: string, value: unknown) =>
    update((draft) => ({ ...draft, display: withKey(draft.display, key, value) }));
  const at = (key: string) => issuesUnder(issues, `/display/${key}`);
  const option = (field: { id: string; label: string }) => ({ value: field.id, label: field.label });
  const { display } = definition;
  const titleField = (
    <SelectControl
      id="definition-title-field"
      label={t('models.builder.titleField')}
      hint={t('models.builder.titleFieldHint')}
      value={display.titleFieldId}
      options={titleFieldCandidates(definition).map(option)}
      onChange={(value) => setDisplay('titleFieldId', value)}
      unsetLabel={t('models.notSet')}
      issues={at('titleFieldId')}
      disabled={disabled}
    />
  );
  if (definition.kind === 'component') {
    return titleField;
  }
  const sort = definition.display.defaultSort;
  const sortable = definition.fields.filter((field) => field.sortable);
  return (
    <>
      {titleField}
      <SelectControl
        id="definition-sort-field"
        label={t('models.builder.sortField')}
        hint={t('models.builder.sortFieldHint')}
        value={sort?.fieldId}
        options={sortable.map(option)}
        onChange={(fieldId) =>
          setDisplay('defaultSort', fieldId ? { fieldId, direction: sort?.direction ?? 'asc' } : undefined)
        }
        unsetLabel={t('models.builder.sortNewest')}
        issues={at('defaultSort')}
        disabled={disabled}
      />
      {sort ? (
        <SelectControl
          id="definition-sort-direction"
          label={t('models.builder.sortDirection')}
          value={sort.direction}
          options={SORT_DIRECTIONS.map((direction) => ({
            value: direction,
            label: t(DIRECTION_LABEL_KEYS[direction]),
          }))}
          onChange={(direction) => direction && setDisplay('defaultSort', { ...sort, direction })}
          disabled={disabled}
        />
      ) : null}
      <ChoicesControl
        id="definition-list-fields"
        label={t('models.builder.listColumns')}
        value={definition.display.listFieldIds ?? []}
        options={definition.fields.map(option)}
        onChange={(ids) => setDisplay('listFieldIds', ids.length > 0 ? ids : undefined)}
        issues={at('listFieldIds')}
        disabled={disabled}
      />
      <DocumentLayout model={definition} issues={issues} disabled={disabled} />
    </>
  );
};
