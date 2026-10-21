import {
  isModelDefinition,
  routeKeyOf,
  type InterfaceDefinition,
  type ModelDefinition,
  type SchemaDefinition,
  type ValidationIssue,
} from '@shapio/schema';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { followPlural } from '../../helpers/followPlural';
import { issuesUnder } from '../../helpers/issues';
import { useModelIndex } from '../../hooks/useModelIndex';
import { SelectControl } from '../controls/SelectControl';
import { SwitchControl } from '../controls/SwitchControl';
import { TextControl } from '../controls/TextControl';
import { useResolvedDraftAndParent } from '../hooks/useResolvedDraftAndParent';
import { PanelSection } from '../PanelSection';
import { Display } from './Display';
import { Implements } from './Implements';

type DefinitionPanelProps = {
  issues: readonly ValidationIssue[];
  disabled: boolean;
  /** Where the definition is available (the `Scope` section), first; absent on a single-site instance. */
  scopeSection?: ReactNode;
  /** The collections this one may extend (same scope, not its own family). */
  parentChoices: readonly ModelDefinition[];
  /** How many kinds extend this one directly: their flags must stay equal to its own. */
  kindCount: number;
  /** The interfaces this type may implement (collections and singletons; same scope rules as `extends`). */
  interfaceChoices: readonly InterfaceDefinition[];
};

/** Collections and interfaces have a plural API ID (their list route and query). */
const withPlural = (definition: SchemaDefinition): definition is ModelDefinition | InterfaceDefinition =>
  definition.kind === 'collection' || definition.kind === 'interface';

/** The definition's own settings (the expanded Model settings panel): naming, content and display. */
export const DefinitionPanel = ({
  issues,
  disabled,
  scopeSection,
  parentChoices,
  kindCount,
  interfaceChoices,
}: DefinitionPanelProps) => {
  const { t } = useTranslation();
  const draft = useDefinitionDraftStore((state) => state.draft);
  const base = useDefinitionDraftStore((state) => state.base);
  const update = useDefinitionDraftStore((state) => state.update);
  const { resolved, parent } = useResolvedDraftAndParent();
  const { index } = useModelIndex();
  if (!draft || !resolved) {
    return null;
  }
  const set = (patch: Record<string, unknown>) => update((current) => ({ ...current, ...patch }));
  const at = (property: string) => issuesUnder(issues, `/${property}`);
  const renamed = base !== null && base.apiKey !== draft.apiKey;
  const pluralRenamed =
    base !== null && withPlural(base) && withPlural(draft) && routeKeyOf(base) !== routeKeyOf(draft);
  // A collection's (or interface's) plural follows the API ID until it has been edited by hand (decision 8).
  const setApiKey = (apiKey: string) =>
    update((current) =>
      current.kind === 'collection' || current.kind === 'interface'
        ? { ...current, apiKey, pluralApiKey: followPlural(current.apiKey, apiKey, current.pluralApiKey) }
        : { ...current, apiKey },
    );
  // Re-parenting goes through the review like any contract change. A kind's flags equal its parent's, so
  // they follow the new parent.
  const setParent = (parentId: string | undefined) =>
    update((current) => {
      if (current.kind !== 'collection') {
        return current;
      }
      const { extends: _previous, ...rest } = current;
      const next = index.get(parentId ?? '');
      if (parentId === undefined || !next || next.kind !== 'collection') {
        return parentId === undefined ? rest : { ...rest, extends: parentId };
      }
      return { ...rest, extends: parentId, localized: next.localized, draftAndPublish: next.draftAndPublish };
    });
  const parentId = draft.kind === 'collection' ? draft.extends : undefined;
  const parentLabel = parentId === undefined ? undefined : (index.get(parentId)?.label ?? parentId);
  // The current parent stays listed even when it would no longer be offered (another scope, say).
  const parentOptions = [
    ...(parentId !== undefined && !parentChoices.some((choice) => choice.id === parentId)
      ? [{ value: parentId, label: parentLabel ?? parentId }]
      : []),
    ...parentChoices.map((choice) => ({ value: choice.id, label: choice.label })),
  ];
  const baseParentId = base?.kind === 'collection' ? base.extends : undefined;
  const reparented = base !== null && baseParentId !== parentId;
  // A kind's flags are its parent's; a parent's flags are shared by its kinds, so neither can change alone.
  const flagsHint =
    parentLabel !== undefined
      ? t('models.inheritance.flagsFollowParent', { model: parentLabel })
      : kindCount > 0
        ? t('models.inheritance.flagsSharedWithKinds', { count: kindCount })
        : undefined;
  const flagsLocked = flagsHint !== undefined;
  return (
    <div className="space-y-6">
      {scopeSection}
      <PanelSection title={t('models.builder.general')}>
        <TextControl
          id="definition-label"
          label={t('models.label')}
          value={draft.label}
          onChange={(label) => set({ label: label ?? '' })}
          issues={at('label')}
          disabled={disabled}
        />
        <TextControl
          id="definition-apiKey"
          label={t('models.apiKey')}
          hint={t('models.apiKeyHint')}
          description={renamed ? t('models.builder.apiKeyRenameWarning') : undefined}
          value={draft.apiKey}
          onChange={(apiKey) => setApiKey(apiKey ?? '')}
          issues={at('apiKey')}
          disabled={disabled}
          monospace
        />
        {withPlural(draft) ? (
          <TextControl
            id="definition-pluralApiKey"
            label={t('models.pluralApiKey')}
            hint={t('models.pluralApiKeyHint')}
            description={pluralRenamed ? t('models.builder.pluralApiKeyRenameWarning') : undefined}
            value={draft.pluralApiKey}
            onChange={(pluralApiKey) => set({ pluralApiKey })}
            issues={at('pluralApiKey')}
            disabled={disabled}
            emptyAsUndefined
            monospace
          />
        ) : null}
        {draft.kind === 'collection' ? (
          <SelectControl
            id="definition-extends"
            label={t('models.inheritance.extends')}
            hint={t('models.inheritance.extendsHint')}
            description={reparented ? t('models.inheritance.reparentWarning') : undefined}
            value={parentId}
            options={parentOptions}
            unsetLabel={t('models.inheritance.noParent')}
            onChange={setParent}
            issues={at('extends')}
            disabled={disabled}
          />
        ) : null}
        {isModelDefinition(draft) ? (
          <Implements
            model={draft}
            choices={interfaceChoices}
            issues={at('implements')}
            disabled={disabled}
          />
        ) : null}
        <TextControl
          id="definition-description"
          label={t('models.descriptionLabel')}
          value={draft.description}
          onChange={(description) => set({ description })}
          issues={at('description')}
          disabled={disabled}
          emptyAsUndefined
          multiline
        />
        {draft.kind === 'component' ? (
          <TextControl
            id="definition-category"
            label={t('models.builder.category')}
            hint={t('models.builder.categoryHint')}
            value={draft.category}
            onChange={(category) => set({ category })}
            issues={at('category')}
            disabled={disabled}
            emptyAsUndefined
          />
        ) : null}
      </PanelSection>
      {!isModelDefinition(draft) ? null : (
        <PanelSection title={t('models.builder.content')}>
          <SwitchControl
            id="definition-localized"
            label={t('models.localized')}
            hint={t('models.builder.modelLocalizedHint')}
            description={flagsHint}
            checked={draft.localized}
            onChange={(localized) => set({ localized })}
            issues={at('localized')}
            // A mismatch the validator reports stays fixable.
            disabled={disabled || (flagsLocked && at('localized').length === 0)}
          />
          <SwitchControl
            id="definition-draftAndPublish"
            label={t('models.builder.draftAndPublish')}
            hint={t('models.builder.draftAndPublishHint')}
            description={flagsHint}
            checked={draft.draftAndPublish}
            onChange={(draftAndPublish) => set({ draftAndPublish })}
            issues={at('draftAndPublish')}
            disabled={disabled || (flagsLocked && at('draftAndPublish').length === 0)}
          />
        </PanelSection>
      )}
      <PanelSection title={t('models.builder.display')}>
        <Display definition={resolved} own={draft} parent={parent} issues={issues} disabled={disabled} />
      </PanelSection>
    </div>
  );
};
