import { effectiveLayout, type ModelDefinition } from '@shapio/schema';
import { useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { LoadingState } from '@/components/LoadingState';
import { Page } from '@/components/Page';
import { UnsavedChangesGuard } from '@/components/UnsavedChangesGuard';
import { EntrySiblings } from '@/fields/form/EntrySiblings';
import { FieldsProvider } from '@/fields/form/FieldsProvider';
import { entryTitle } from '@/fields/helpers/titles';
import type { FormValues } from '@/fields/helpers/values';
import { cn } from '@/helpers/cn';
import { useSaveShortcut } from '@/hooks/useSaveShortcut';
import { useContentLocales } from '../hooks/useContentLocales';
import type { ContentSchema } from '../hooks/useContentSchema';
import { LocaleSelect } from '../LocaleSelect';
import { Canvas } from './Canvas';
import { Cover } from './Cover';
import { CoverSettings } from './CoverSettings';
import { DangerZone } from './DangerZone';
import { HistorySheet } from './HistorySheet';
import { useDocumentPaletteActions } from './hooks/useDocumentPaletteActions';
import { useDocumentShortcuts } from './hooks/useDocumentShortcuts';
import { useEntryDocument } from './hooks/useEntryDocument';
import { useEntryPresence } from './hooks/useEntryPresence';
import { usePreflightFlow } from './hooks/usePreflightFlow';
import { useRevealField } from './hooks/useRevealField';
import { useSettingsDrawer } from './hooks/useSettingsDrawer';
import { NoFields } from './NoFields';
import { Notices } from './Notices';
import { PreflightSheet } from './PreflightSheet';
import { Presence } from './Presence';
import { PreviewPane } from './Preview';
import { useEntryPreview } from './Preview/hooks/useEntryPreview';
import { PreviewButton } from './PreviewButton';
import { PropertiesStrip } from './PropertiesStrip';
import { PropertyGrid } from './PropertyGrid';
import { SaveState } from './SaveState';
import { SettingsDrawer } from './SettingsDrawer';
import { StatusSection } from './StatusSection';
import { Title } from './Title';
import { TopBar, type PrimaryAction } from './TopBar';
import type { EntryMode, ReloadEntry } from './types';

type EntryDocumentProps = {
  schema: ContentSchema;
  model: ModelDefinition;
  mode: EntryMode;
  locale: string | null;
  /** Local values to reapply over the loaded ones (after "reload and keep my changes"). */
  carry?: FormValues;
  onReload: ReloadEntry;
  onLocaleChange: (code: string) => void;
};

/**
 * An entry as a document you write, not a form you fill (plan editor-experience §3): a thin top bar, the
 * cover, the title typed into the page, a strip of properties, and the canvas of blocks; everything else
 * in a settings drawer beside it, and publishing through a pre-flight. A model without canvas fields shows
 * its properties as a grid under the title. Autosave keeps drafts safe; ⌘S records a version.
 */
export const EntryDocument = ({
  schema,
  model,
  mode,
  locale,
  carry,
  onReload,
  onLocaleChange,
}: EntryDocumentProps) => {
  const { t } = useTranslation();
  const { locales, defaultLocale, labelOf } = useContentLocales(model, locale ?? undefined);
  const entryDocument = useEntryDocument({ schema, model, mode, locale, defaultLocale, carry, onReload });
  const { setup, saver, lifecycle, publishing, permissions, conflict, dirty } = entryDocument;
  const { store, entry, entryId, environment } = setup;
  const layout = useMemo(() => effectiveLayout(model), [model]);
  const drawer = useSettingsDrawer();
  const preflight = usePreflightFlow(saver.save);
  // `?revision=` (Snapshots → Timeline, "Open this version") opens the history at that revision.
  const { revision: linkedRevision } = useSearch({ strict: false });
  const [historyOpen, setHistoryOpen] = useState(linkedRevision !== undefined);
  const people = useEntryPresence(model.apiKey, mode.kind === 'edit' ? entryId : null, locale);
  const reveal = useRevealField(environment.idPrefix, (apiKey) =>
    drawer.openAt({ section: 'properties', property: apiKey }),
  );
  const preview = useEntryPreview({
    model,
    components: schema.components,
    entryId: mode.kind === 'edit' ? entryId : null,
    locale,
    store,
    saveStatus: saver.state.status,
    reveal,
  });
  const titleValue = useStore(store, (state) =>
    layout.title ? state.values[layout.title.apiKey] : undefined,
  );
  const blocked = conflict !== undefined;
  const canPublish = mode.kind === 'edit' && model.draftAndPublish && permissions.canPublish;
  useSaveShortcut(entryDocument.save, !blocked && entryDocument.editable);
  useDocumentShortcuts(
    {
      onPublish: canPublish && !blocked ? preflight.start : undefined,
      onToggleSettings: drawer.toggle,
      onCycleLocale:
        model.localized && locale && locales.length > 1
          ? () => {
              const index = locales.findIndex((item) => item.code === locale);
              const next = locales[(index + 1) % locales.length];
              if (next) {
                onLocaleChange(next.code);
              }
            }
          : undefined,
    },
    true,
  );

  useDocumentPaletteActions({
    onPublish: canPublish && !blocked ? preflight.start : undefined,
    onOpenSettings: () => drawer.openAt({ section: 'status' }),
    locales,
    entry,
    onLocaleChange: model.localized && locales.length > 1 ? onLocaleChange : undefined,
  });

  if (setup.runtimeLoading) {
    return <LoadingState rows={6} />;
  }
  const heading =
    entryTitle(model, layout.title ? { [layout.title.apiKey]: titleValue } : {}) ??
    (mode.kind === 'create' ? t('content.form.newTitle', { model: model.label }) : t('content.untitled'));
  const autosaved = entry?.autosaved ?? false;
  const primary: PrimaryAction =
    mode.kind === 'create'
      ? permissions.canCreate
        ? {
            kind: 'create',
            label: t('content.form.create'),
            pending: lifecycle.creating,
            onClick: entryDocument.save,
          }
        : { kind: 'none' }
      : mode.kind === 'newLocale'
        ? {
            kind: 'create',
            label: t('content.form.createLocale', { locale: labelOf(locale ?? '') }),
            pending: saver.state.status === 'saving',
            onClick: entryDocument.save,
          }
        : canPublish
          ? {
              kind: 'publish',
              upToDate: entry?.status === 'published' && !dirty && !autosaved,
              onClick: preflight.start,
            }
          : model.draftAndPublish || !entryDocument.editable
            ? { kind: 'none' }
            : {
                kind: 'save',
                label: t('content.form.save'),
                pending: saver.state.status === 'saving',
                onClick: entryDocument.save,
              };
  // With Publish as the primary action, Save (a validated version) shows while there is something to record.
  const showSave = primary.kind === 'publish' && entryDocument.editable && (dirty || autosaved);
  const live = entry !== null && entry.status !== 'draft';
  const hasFields =
    layout.title !== undefined ||
    layout.cover !== undefined ||
    layout.canvas.length > 0 ||
    layout.properties.length > 0;
  return (
    <FieldsProvider environment={environment} store={store}>
      <EntrySiblings>
        <Page
          width="full"
          className={cn(
            'space-y-0 transition-[padding]',
            // The settings drawer overlays the preview when both are open.
            !preview.open && drawer.open && 'xl:pr-90',
          )}
        >
          <TopBar
            model={model}
            title={heading}
            status={entry?.status}
            saveState={
              mode.kind === 'edit' ? (
                <SaveState state={saver.state} dirty={dirty} autosaved={autosaved} />
              ) : null
            }
            presence={<Presence people={people} />}
            locale={
              model.localized && locale ? (
                <LocaleSelect
                  locales={locales}
                  value={locale}
                  onChange={onLocaleChange}
                  states={entry?.locales ?? []}
                  size="sm"
                  className="w-auto"
                />
              ) : null
            }
            preview={
              mode.kind === 'edit' ? (
                <PreviewButton
                  available={preview.available}
                  pressed={preview.open && !preview.documentShown}
                  onToggle={preview.toggle}
                />
              ) : null
            }
            onSave={showSave ? entryDocument.save : undefined}
            saving={saver.state.status === 'saving' || lifecycle.creating}
            blocked={blocked}
            settingsOpen={drawer.open}
            onToggleSettings={drawer.toggle}
            primary={primary}
          />
          {/* The preview takes the right half of the screen under the top bar on lg and up. */}
          <div className={cn(preview.open && 'lg:pr-[calc(50vw-2rem)]')}>
            <article
              aria-label={heading}
              className="mx-auto w-full max-w-3xl space-y-6 pt-8 pb-40 lg:px-16"
              data-entry-document
            >
              <Notices
                conflict={conflict}
                reloading={entryDocument.reloading}
                onReload={entryDocument.reload}
                newLocaleLabel={mode.kind === 'newLocale' ? labelOf(locale ?? '') : undefined}
                referrers={lifecycle.referrers}
                models={schema.models}
                onDismissReferrers={lifecycle.clearReferrers}
                outdated={
                  model.draftAndPublish && !publishing.othersDismissed
                    ? (entry?.sharedOutdatedLocales ?? [])
                    : []
                }
                labelOf={labelOf}
                publishing={publishing.publishing}
                onPublishOthers={(others) => void publishing.publishOthers(others)}
                onDismissOthers={publishing.dismissOthers}
              />
              {hasFields ? null : <NoFields model={model} canManageSchema={permissions.canManageSchema} />}
              {layout.cover ? (
                <Cover field={layout.cover} onEditDetails={() => drawer.openAt({ section: 'cover' })} />
              ) : null}
              <Title field={layout.titleInline ? layout.title : undefined} heading={heading} />
              {layout.canvas.length > 0 ? (
                <>
                  <PropertiesStrip layout={layout} onMore={() => drawer.openAt({ section: 'properties' })} />
                  <Canvas fields={layout.canvas} />
                </>
              ) : (
                <PropertyGrid groups={layout.propertyGroups} />
              )}
            </article>
          </div>
        </Page>
        <PreviewPane preview={preview} title={heading} />
        <SettingsDrawer
          open={drawer.open}
          onOpenChange={drawer.setOpen}
          focus={drawer.focus}
          layout={layout}
          expanded={drawer.expanded}
          onToggleProperty={drawer.toggleProperty}
          status={
            <StatusSection
              model={model}
              entry={entry}
              locales={locales}
              locale={locale}
              defaultLocale={defaultLocale}
              labelOf={labelOf}
              onLocaleChange={onLocaleChange}
              onCopyFromDefault={
                model.localized && entryId !== null && defaultLocale !== undefined && locale !== defaultLocale
                  ? lifecycle.copyFromDefault
                  : undefined
              }
              confirmCopy={entryDocument.hasLocalizedValues}
            />
          }
          cover={layout.cover ? <CoverSettings field={layout.cover} /> : null}
          onOpenHistory={mode.kind === 'edit' ? () => setHistoryOpen(true) : undefined}
          danger={
            mode.kind === 'edit' ? (
              <DangerZone
                title={heading}
                onUnpublish={canPublish && live ? publishing.unpublish : undefined}
                onDuplicate={
                  model.kind === 'collection' && permissions.canCreate
                    ? () => void lifecycle.duplicate()
                    : undefined
                }
                onDelete={permissions.canDelete ? lifecycle.remove : undefined}
              />
            ) : null
          }
        />
        {entryId && canPublish ? (
          <PreflightSheet
            open={preflight.open}
            onOpenChange={preflight.setOpen}
            entryId={entryId}
            ready={preflight.ready}
            labelOf={labelOf}
            canSchedule={permissions.canSchedule}
            canUseChangeSets={permissions.canUseChangeSets}
            publishing={publishing.publishing || saver.state.status === 'saving'}
            onPublish={publishing.publish}
            onFix={reveal}
          />
        ) : null}
        {setup.mediaDialog}
        {entryId && mode.kind === 'edit' ? (
          <HistorySheet
            open={historyOpen}
            onOpenChange={setHistoryOpen}
            model={model}
            components={schema.components}
            entryId={entryId}
            locale={locale}
            restoring={lifecycle.restoring}
            confirmRestore={dirty}
            onRestore={lifecycle.restore}
            initialRevisionId={linkedRevision}
          />
        ) : null}
        <UnsavedChangesGuard when={dirty && !blocked} />
      </EntrySiblings>
    </FieldsProvider>
  );
};
