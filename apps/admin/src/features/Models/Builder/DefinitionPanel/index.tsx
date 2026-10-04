import { routeKeyOf, type ValidationIssue } from '@shapio/schema';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useDefinitionDraftStore } from '@/stores/definitionDraft';
import { followPlural } from '../../helpers/followPlural';
import { issuesUnder } from '../../helpers/issues';
import { SwitchControl } from '../controls/SwitchControl';
import { TextControl } from '../controls/TextControl';
import { PanelSection } from '../PanelSection';
import { Display } from './Display';

type DefinitionPanelProps = {
  issues: readonly ValidationIssue[];
  disabled: boolean;
  /** Where the definition is available (the `Scope` section), first; absent on a single-site instance. */
  scopeSection?: ReactNode;
};

/** The definition's own settings (the expanded Model settings panel): naming, content and display. */
export const DefinitionPanel = ({ issues, disabled, scopeSection }: DefinitionPanelProps) => {
  const { t } = useTranslation();
  const draft = useDefinitionDraftStore((state) => state.draft);
  const base = useDefinitionDraftStore((state) => state.base);
  const update = useDefinitionDraftStore((state) => state.update);
  if (!draft) {
    return null;
  }
  const set = (patch: Record<string, unknown>) => update((current) => ({ ...current, ...patch }));
  const at = (property: string) => issuesUnder(issues, `/${property}`);
  const renamed = base !== null && base.apiKey !== draft.apiKey;
  const pluralRenamed =
    base?.kind === 'collection' && draft.kind === 'collection' && routeKeyOf(base) !== routeKeyOf(draft);
  // A collection's plural follows the API ID until it has been edited by hand (decision 8).
  const setApiKey = (apiKey: string) =>
    update((current) =>
      current.kind === 'collection'
        ? { ...current, apiKey, pluralApiKey: followPlural(current.apiKey, apiKey, current.pluralApiKey) }
        : { ...current, apiKey },
    );
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
        {draft.kind === 'collection' ? (
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
      {draft.kind === 'component' ? null : (
        <PanelSection title={t('models.builder.content')}>
          <SwitchControl
            id="definition-localized"
            label={t('models.localized')}
            hint={t('models.builder.modelLocalizedHint')}
            checked={draft.localized}
            onChange={(localized) => set({ localized })}
            issues={at('localized')}
            disabled={disabled}
          />
          <SwitchControl
            id="definition-draftAndPublish"
            label={t('models.builder.draftAndPublish')}
            hint={t('models.builder.draftAndPublishHint')}
            checked={draft.draftAndPublish}
            onChange={(draftAndPublish) => set({ draftAndPublish })}
            issues={at('draftAndPublish')}
            disabled={disabled}
          />
        </PanelSection>
      )}
      <PanelSection title={t('models.builder.display')}>
        <Display definition={draft} issues={issues} disabled={disabled} />
      </PanelSection>
    </div>
  );
};
