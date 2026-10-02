import type { FieldDefinition, ValidationIssue } from '@shapio/schema';
import { Plus } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Panel } from '@/components/Panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { moveItem } from '../../helpers/draft';
import { fieldPath, issuesUnder } from '../../helpers/issues';
import { IssueList } from '../controls/IssueList';
import { ADD_FIELD_BUTTON_ID } from '../hooks/useNewField';
import { handleIdOf } from './handleId';
import { Row } from './Row';

type FieldListProps = {
  issues: readonly ValidationIssue[];
  disabled: boolean;
  onAdd: () => void;
};

const NO_FIELDS: FieldDefinition[] = [];

/** The draft's fields in order: select one to edit it, reorder by drag, arrow keys or chevrons. */
export const FieldList = ({ issues, disabled, onAdd }: FieldListProps) => {
  const { t } = useTranslation();
  const fields = useDefinitionDraftStore((state) => state.draft?.fields ?? NO_FIELDS);
  const localized = useDefinitionDraftStore(
    (state) => state.draft?.kind !== 'component' && state.draft?.localized === true,
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
    update((draft) => ({ ...draft, fields: moveItem(draft.fields, from, to) }));
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
          <Button id={ADD_FIELD_BUTTON_ID} type="button" size="sm" onClick={onAdd} disabled={disabled}>
            <Plus aria-hidden="true" />
            {t('models.builder.addField')}
          </Button>
        </>
      }
      bodyClassName="p-2"
    >
      {definitionIssues.length > 0 ? (
        <div className="px-3 py-2">
          <IssueList issues={definitionIssues} />
        </div>
      ) : null}
      {fields.length === 0 ? (
        <p className="px-3 py-6 text-center text-meta text-muted-foreground">
          {t('models.builder.noFields')}
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
