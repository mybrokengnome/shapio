import { type FieldDefinition, type ValidationIssue } from '@shapio/schema';
import { Trash2 } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconTile } from '@/components/IconTile';
import { Panel } from '@/components/Panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { DATA_TYPE_ICONS } from '../../constants';
import { supportsDefaultValue } from '../../helpers/defaultValue';
import { deriveApiKey } from '../../helpers/deriveApiKey';
import { pruneLayout, removeField, withCompatibleEditor, withSetting } from '../../helpers/draft';
import { fieldPath, issuesUnder } from '../../helpers/issues';
import { withFieldTypeOrSaved } from '../../helpers/newField';
import { IssueList } from '../controls/IssueList';
import { TextControl } from '../controls/TextControl';
import { labelInputIdOf } from '../hooks/useNewField';
import { PanelSection } from '../PanelSection';
import { DataType } from './DataType';
import { DefaultValue } from './DefaultValue';
import { EditorPicker } from './EditorPicker';
import { Flags } from './Flags';
import { useTypeChoices } from './hooks/useTypeChoices';
import { Placement } from './Placement';
import { TypeSettings } from './TypeSettings';

type FieldPanelProps = {
  field: FieldDefinition;
  index: number;
  issues: readonly ValidationIssue[];
  disabled: boolean;
  /** The field was just added and is still untouched: Escape discards it. */
  untouched: boolean;
  onDiscard: () => void;
};

/** Field properties that have their own control; issues anywhere else are listed at the top. */
const CONTROLLED = new Set([
  'label',
  'apiKey',
  'description',
  'required',
  'unique',
  'filterable',
  'sortable',
  'public',
  'localized',
  'deprecated',
  'defaultValue',
  'editor',
  'settings',
]);

/**
 * Everything about one field: data type, naming, options, type settings and editor. A field that isn't
 * saved yet can take any type and its API ID follows its label until edited; a saved one can change to the
 * types Shapio can convert it to.
 */
export const FieldPanel = ({ field, index, issues, disabled, untouched, onDiscard }: FieldPanelProps) => {
  const { t } = useTranslation();
  const draft = useDefinitionDraftStore((state) => state.draft);
  const base = useDefinitionDraftStore((state) => state.base);
  const updateField = useDefinitionDraftStore((state) => state.updateField);
  const update = useDefinitionDraftStore((state) => state.update);
  const select = useDefinitionDraftStore((state) => state.select);
  const saved = base?.fields.find((candidate) => candidate.id === field.id);
  const typeChoices = useTypeChoices(base, saved, field.type);
  if (!draft) {
    return null;
  }
  const path = fieldPath(index);
  const at = (property: string) => issuesUnder(issues, `${path}/${property}`);
  const otherIssues = issuesUnder(issues, path).filter(
    (found) => !CONTROLLED.has(found.path.slice(path.length + 1).split('/')[0] ?? ''),
  );
  const set = (patch: Partial<FieldDefinition>) =>
    updateField(field.id, (current) => ({ ...current, ...patch }) as FieldDefinition);
  const id = (name: string) => `field-${field.id}-${name}`;
  const renamed = saved !== undefined && saved.apiKey !== field.apiKey;
  const isNew = base !== null && saved === undefined;
  const label = field.label || t('models.builder.untitled');
  const setLabel = (next: string) => {
    const followsLabel = isNew && field.apiKey === deriveApiKey(field.label);
    set({ label: next, ...(followsLabel ? { apiKey: deriveApiKey(next) } : {}) });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Escape in something the panel opened (a select, an info popover) is that layer's to handle.
    if (event.key !== 'Escape' || event.nativeEvent.defaultPrevented || !untouched) {
      return;
    }
    if (event.target instanceof Node && event.currentTarget.contains(event.target)) {
      event.preventDefault();
      onDiscard();
    }
  };

  return (
    // Keyboard handling only: Escape discards an untouched new field (focus is on a control inside).
    <div onKeyDown={onKeyDown}>
      <Panel aria-label={t('models.builder.fieldProperties', { label })} flush>
        <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
          <IconTile icon={DATA_TYPE_ICONS[field.type]} />
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">
            <h2 className="min-w-0 truncate text-base font-semibold">{label}</h2>
            <Badge variant="secondary">{t(`models.dataTypes.${field.type}.name`)}</Badge>
          </div>
          <Button
            type="button"
            variant="destructive-ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              update((current) => removeField(current, field.id));
              select({ type: 'definition' });
            }}
          >
            <Trash2 aria-hidden="true" />
            {t('models.builder.removeField')}
          </Button>
        </div>
        <div className="space-y-5 p-5">
          <IssueList issues={otherIssues} />

          <PanelSection title={t('models.builder.dataType')} titleId={id('type-heading')}>
            <DataType
              labelledBy={id('type-heading')}
              value={field.type}
              {...typeChoices}
              disabled={disabled}
              onChange={(type) =>
                update((current) => pruneLayout(withFieldTypeOrSaved(current, field.id, type, saved)))
              }
            />
          </PanelSection>

          <PanelSection title={t('models.builder.general')}>
            <div className="grid items-start gap-5 @lg/field-group:grid-cols-2">
              <TextControl
                id={labelInputIdOf(field.id)}
                label={t('models.label')}
                value={field.label}
                onChange={(next) => setLabel(next ?? '')}
                issues={at('label')}
                disabled={disabled}
              />
              <TextControl
                id={id('apiKey')}
                label={t('models.apiKey')}
                hint={t('models.fieldApiKeyHint')}
                description={renamed ? t('models.builder.apiKeyRenameWarning') : undefined}
                value={field.apiKey}
                onChange={(apiKey) => set({ apiKey: apiKey ?? '' })}
                issues={at('apiKey')}
                disabled={disabled}
                monospace
              />
            </div>
            <TextControl
              id={id('description')}
              label={t('models.builder.helpText')}
              value={field.description}
              onChange={(description) => set({ description })}
              issues={at('description')}
              disabled={disabled}
              emptyAsUndefined
              multiline
            />
            {draft.kind !== 'component' && !field.deprecated ? (
              <Placement model={draft} field={field} issues={issues} disabled={disabled} />
            ) : null}
          </PanelSection>

          <PanelSection title={t('models.builder.options')}>
            <Flags field={field} draft={draft} at={at} disabled={disabled} onChange={set} />
          </PanelSection>

          <PanelSection title={t('models.builder.settings')}>
            <TypeSettings
              field={field}
              draft={draft}
              path={path}
              issues={issues}
              disabled={disabled}
              onChange={(key, value) =>
                update((current) =>
                  pruneLayout({
                    ...current,
                    fields: current.fields.map((candidate) =>
                      candidate.id === field.id
                        ? withCompatibleEditor(withSetting(candidate, key, value))
                        : candidate,
                    ),
                  }),
                )
              }
            />
            {supportsDefaultValue(field) ? (
              <DefaultValue
                field={field}
                issues={at('defaultValue')}
                disabled={disabled}
                onChange={(defaultValue) =>
                  updateField(field.id, (current) => {
                    const next: Record<string, unknown> = { ...current, defaultValue };
                    if (defaultValue === undefined) {
                      delete next.defaultValue;
                    }
                    return next as FieldDefinition;
                  })
                }
              />
            ) : null}
          </PanelSection>

          <PanelSection title={t('models.builder.editorSection')}>
            <EditorPicker
              field={field}
              path={path}
              issues={issues}
              disabled={disabled}
              onChange={(editor) => set({ editor })}
            />
          </PanelSection>
        </div>
      </Panel>
    </div>
  );
};
