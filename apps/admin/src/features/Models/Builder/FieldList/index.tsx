import {
  isModelDefinition,
  type FieldDefinition,
  type ResolvedField,
  type ValidationIssue,
} from '@shapio/schema';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Panel } from '@/components/Panel';
import { Badge } from '@/components/ui/badge';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { moveItem, pruneLayout } from '../../helpers/draft';
import type { DraftParent } from '../../helpers/inheritance';
import { fieldPath, issuesUnder } from '../../helpers/issues';
import { fieldTargetLabel } from '../../helpers/relationTargetLabel';
import { IssueList } from '../controls/IssueList';
import type { useAddSeoField } from '../hooks/useAddSeoField';
import { useDraftDefinitionIndex } from '../hooks/useDraftDefinitionIndex';
import { AddFieldButton } from './AddFieldButton';
import { handleIdOf } from './handleId';
import { Inherited } from './Inherited';
import { Row } from './Row';

type FieldListProps = {
  issues: readonly ValidationIssue[];
  disabled: boolean;
  onAdd: () => void;
  /** "Add field → SEO fields" (models only). */
  seo?: ReturnType<typeof useAddSeoField>;
  /** The collection the draft extends: its fields are listed above the draft's own, locked. */
  parent?: DraftParent;
  /** The inherited fields (resolved, ancestors' first). */
  inherited?: readonly ResolvedField[];
  /** Fields an interface requires, by ID, with the interfaces' names (the "Required by" badge). */
  contractFields?: ReadonlyMap<string, readonly string[]>;
};

const NO_FIELDS: FieldDefinition[] = [];
const NO_INHERITED: readonly ResolvedField[] = [];
const NO_CONTRACT_FIELDS: ReadonlyMap<string, readonly string[]> = new Map();

/**
 * The draft's fields in order: select one to edit it, reorder by drag, arrow keys or chevrons. A kind lists
 * the fields it inherits first, locked; positions and issue paths count its own fields only.
 */
export const FieldList = ({
  issues,
  disabled,
  onAdd,
  seo,
  parent,
  inherited = NO_INHERITED,
  contractFields = NO_CONTRACT_FIELDS,
}: FieldListProps) => {
  const { t } = useTranslation();
  const draft = useDefinitionDraftStore((state) => state.draft);
  const fields = draft?.fields ?? NO_FIELDS;
  const { index } = useDraftDefinitionIndex(draft);
  const targetOf = (field: FieldDefinition) => fieldTargetLabel(field, index, t);
  const localized = useDefinitionDraftStore(
    (state) =>
      state.draft !== null &&
      state.draft !== undefined &&
      isModelDefinition(state.draft) &&
      state.draft.localized,
  );
  const selection = useDefinitionDraftStore((state) => state.selection);
  const select = useDefinitionDraftStore((state) => state.select);
  const update = useDefinitionDraftStore((state) => state.update);
  const dragFrom = useRef<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const move = (from: number, to: number, refocus: boolean) => {
    const moved = fields[from];
    if (!moved || from === to) {
      return;
    }
    // A move can change the automatic title field, which then leaves the document (`pruneLayout`).
    update((draft) => pruneLayout({ ...draft, fields: moveItem(draft.fields, from, to) }, parent));
    setAnnouncement(
      t('models.builder.moved', { label: moved.label, position: to + 1, total: fields.length }),
    );
    if (refocus) {
      // The row's DOM node moves; put focus back on its handle so arrow keys keep working.
      requestAnimationFrame(() => document.getElementById(handleIdOf(moved.id))?.focus());
    }
  };
  const definitionIssues = issuesUnder(issues, '/fields').filter(
    (found) => !/^\/fields\/\d+/.test(found.path),
  );

  const count = t('models.builder.fields', { count: fields.length });
  return (
    <Panel
      title={t('models.builder.fieldsTitle')}
      flush
      actions={
        <>
          <Badge variant="secondary" aria-hidden="true">
            {fields.length}
          </Badge>
          <AddFieldButton disabled={disabled} onAdd={onAdd} seo={seo} />
        </>
      }
      bodyClassName="p-2"
    >
      {definitionIssues.length > 0 ? (
        <div className="px-3 py-2">
          <IssueList issues={definitionIssues} />
        </div>
      ) : null}
      <Inherited fields={inherited} showLocalized={localized} targetOf={targetOf} />
      {inherited.length > 0 ? (
        <h3 className="px-3 pt-2 pb-1 text-meta text-muted-foreground">
          {t('models.inheritance.ownFields')}
        </h3>
      ) : null}
      {fields.length === 0 ? (
        <p className="px-3 py-6 text-center text-meta text-muted-foreground">
          {inherited.length > 0 ? t('models.inheritance.noOwnFields') : t('models.builder.noFields')}
        </p>
      ) : (
        <ol className="space-y-0.5" aria-label={count}>
          {fields.map((field, index) => (
            <Row
              key={field.id}
              field={field}
              index={index}
              total={fields.length}
              selected={selection.type === 'field' && selection.fieldId === field.id}
              hasIssues={issuesUnder(issues, fieldPath(index)).length > 0}
              showLocalized={localized}
              target={targetOf(field)}
              requiredBy={contractFields.get(field.id)}
              dropTarget={dropIndex === index}
              disabled={disabled}
              onSelect={() => select({ type: 'field', fieldId: field.id })}
              onMove={(to) => move(index, to, true)}
              onDragStart={(event) => {
                dragFrom.current = index;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', field.id);
              }}
              onDragOver={(event) => {
                if (dragFrom.current !== null) {
                  event.preventDefault();
                  setDropIndex(index);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragFrom.current !== null) {
                  move(dragFrom.current, index, false);
                }
                dragFrom.current = null;
                setDropIndex(null);
              }}
              onDragEnd={() => {
                dragFrom.current = null;
                setDropIndex(null);
              }}
            />
          ))}
        </ol>
      )}
      <p id="field-reorder-help" className="sr-only">
        {t('models.builder.reorderHelp')}
      </p>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </Panel>
  );
};
