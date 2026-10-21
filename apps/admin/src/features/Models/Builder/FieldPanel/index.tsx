import { isModelDefinition, entryLayoutOf, type FieldDefinition, type ValidationIssue } from '@shapio/schema';
import { Lock, Shapes, Trash2 } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { IconTile } from '@/components/IconTile';
import { Panel } from '@/components/Panel';
import { TextLink } from '@/components/TextLink';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { DATA_TYPE_ICONS, INTERFACE_EXCLUDED_DATA_TYPES } from '../../constants';
import { supportsDefaultValue } from '../../helpers/defaultValue';
import { deriveApiKey } from '../../helpers/deriveApiKey';
import { pruneLayout, removeField, withCompatibleEditor, withSetting } from '../../helpers/draft';
import { missingContractIssues } from '../../helpers/interfaces';
import { fieldPath, issuesUnder } from '../../helpers/issues';
import { withFieldTypeOrSaved } from '../../helpers/newField';
import { IssueList } from '../controls/IssueList';
import { TextControl } from '../controls/TextControl';
import { labelInputIdOf } from '../hooks/useNewField';
import { useResolvedDraftAndParent } from '../hooks/useResolvedDraftAndParent';
import { PanelSection } from '../PanelSection';
import { DataType } from './DataType';
import { DefaultValue } from './DefaultValue';
import { EditorPicker } from './EditorPicker';
import { Flags } from './Flags';
import { Group } from './Group';
import { useTypeChoices } from './hooks/useTypeChoices';
import { Placement } from './Placement';
import { TypeSettings } from './TypeSettings';
import { Width } from './Width';

type FieldPanelProps = {
  field: FieldDefinition;
  index: number;
  issues: readonly ValidationIssue[];
  disabled: boolean;
  /** The field was just added and is still untouched: Escape discards it. */
  untouched: boolean;
  onDiscard: () => void;
  /**
   * The ancestor that declares the field, when the draft inherits it: the panel is read-only and points
   * there (inherited fields are locked; plan polymorphic-types decision 5).
   */
  inheritedFrom?: { id: string; label: string };
  /** The interfaces whose contract this field satisfies, by name: its API ID, type and flags are bound. */
  requiredBy?: readonly string[];
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
  'width',
]);

/**
 * Everything about one field: data type, naming, options, type settings and editor. A field that isn't
 * saved yet takes any type and its API ID follows its label until edited. A saved one can change to any
 * type too; one Shapio can't convert drops the field's stored values.
 */
export const FieldPanel = ({
  field,
  index,
  issues,
  disabled: editingDisabled,
  untouched,
  onDiscard,
  inheritedFrom,
  requiredBy = [],
}: FieldPanelProps) => {
  const { t } = useTranslation();
  const draft = useDefinitionDraftStore((state) => state.draft);
  const { resolved, parent } = useResolvedDraftAndParent();
  const disabled = editingDisabled || inheritedFrom !== undefined;
  const base = useDefinitionDraftStore((state) => state.base);
  const updateField = useDefinitionDraftStore((state) => state.updateField);
  const update = useDefinitionDraftStore((state) => state.update);
  const select = useDefinitionDraftStore((state) => state.select);
  const saved = base?.fields.find((candidate) => candidate.id === field.id);
  const typeChoices = useTypeChoices(base, saved, field.type);
  if (!draft || !resolved) {
    return null;
  }
  const path = fieldPath(index);
  const at = (property: string) => (inheritedFrom ? [] : issuesUnder(issues, `${path}/${property}`));
  // Layout questions (document placement, form widths) are answered over the inherited fields too.
  const model = !isModelDefinition(resolved) ? undefined : resolved;
  const isForm = model !== undefined && entryLayoutOf(model) === 'form';
  // Width has a control on a form's live fields (and on any model field with a width problem); anywhere
  // else, such as a component's field, which may not have one, its issue is listed at the top.
  const showsWidth = model !== undefined && !field.deprecated && (isForm || at('width').length > 0);
  const otherIssues = (inheritedFrom ? [] : issuesUnder(issues, path)).filter((found) => {
    const property = found.path.slice(path.length + 1).split('/')[0] ?? '';
    return !CONTROLLED.has(property) || (property === 'width' && !showsWidth);
  });
  const isContract = draft.kind === 'interface';
  // A rename that breaks a contract is reported on Implements; it shows on this field's API ID too.
  const contractIssues =
    saved === undefined || inheritedFrom
      ? []
      : missingContractIssues(issues).filter((found) => found.fieldApiKey === saved.apiKey);
  const required = requiredBy.length > 0;
  const requiredNames = requiredBy.join(', ');
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
          {inheritedFrom ? null : (
            <Button
              type="button"
              variant="destructive-ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                update((current) => removeField(current, field.id, parent));
                select({ type: 'definition' });
              }}
            >
              <Trash2 aria-hidden="true" />
              {t('models.builder.removeField')}
            </Button>
          )}
        </div>
        <div className="space-y-5 p-5">
          {inheritedFrom ? (
            <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5 text-meta text-muted-foreground">
              <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <Trans
                  i18nKey="models.inheritance.fieldLocked"
                  values={{ model: inheritedFrom.label }}
                  components={{
                    modelLink: <TextLink to="/models/$modelId" params={{ modelId: inheritedFrom.id }} />,
                  }}
                />
              </span>
            </p>
          ) : null}
          {required ? (
            <p className="flex items-start gap-2 rounded-lg bg-muted px-3 py-2.5 text-meta text-muted-foreground">
              <Shapes aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {t('models.implements.fieldNote', { names: requiredNames, count: requiredBy.length })}
              </span>
            </p>
          ) : null}
          <IssueList issues={otherIssues} />

          <PanelSection title={t('models.builder.dataType')} titleId={id('type-heading')}>
            <DataType
              labelledBy={id('type-heading')}
              value={field.type}
              {...typeChoices}
              excluded={isContract ? INTERFACE_EXCLUDED_DATA_TYPES : undefined}
              disabled={disabled}
              onChange={(type) =>
                update((current) =>
                  pruneLayout(withFieldTypeOrSaved(current, field.id, type, saved, parent), parent),
                )
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
                description={
                  required
                    ? t('models.implements.apiKeyRequired', { names: requiredNames })
                    : renamed
                      ? t('models.builder.apiKeyRenameWarning')
                      : undefined
                }
                value={field.apiKey}
                onChange={(apiKey) => set({ apiKey: apiKey ?? '' })}
                issues={[...at('apiKey'), ...contractIssues]}
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
            {model && !field.deprecated && !isForm ? (
              <Placement model={model} field={field} issues={issues} disabled={disabled} />
            ) : null}
            {model && isModelDefinition(draft) && !field.deprecated ? (
              <div className="grid items-start gap-5 @lg/field-group:grid-cols-2">
                {/* A field joins one of the draft's own groups; inherited groups belong to their type. */}
                <Group model={draft} field={field} disabled={disabled} />
                {showsWidth ? <Width field={field} issues={at('width')} disabled={disabled} /> : null}
              </div>
            ) : null}
          </PanelSection>

          <PanelSection title={t('models.builder.options')}>
            <Flags field={field} draft={resolved} at={at} disabled={disabled} onChange={set} />
          </PanelSection>

          <PanelSection title={t('models.builder.settings')}>
            <TypeSettings
              field={field}
              draft={resolved}
              path={path}
              issues={issues}
              disabled={disabled}
              onChange={(key, value) =>
                update((current) =>
                  pruneLayout(
                    {
                      ...current,
                      fields: current.fields.map((candidate) =>
                        candidate.id === field.id
                          ? withCompatibleEditor(withSetting(candidate, key, value))
                          : candidate,
                      ),
                    },
                    parent,
                  ),
                )
              }
            />
            {!isContract && supportsDefaultValue(field) ? (
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

          {/* A contract field is edited on each member, never on the interface: it has no editor. */}
          {isContract ? null : (
            <PanelSection title={t('models.builder.editorSection')}>
              <EditorPicker
                field={field}
                path={path}
                issues={issues}
                disabled={disabled}
                onChange={(editor) => set({ editor })}
              />
            </PanelSection>
          )}
        </div>
      </Panel>
    </div>
  );
};
