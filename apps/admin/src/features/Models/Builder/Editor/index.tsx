import type { DefinitionCategory, DefinitionDetail } from '@shapio/client';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useDeleteDefinition } from '@/api/schema';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { LoadingState } from '@/components/LoadingState';
import { Page } from '@/components/Page';
import { UnsavedChangesGuard } from '@/components/UnsavedChangesGuard';
import { describeError } from '@/helpers/describeError';
import { logError } from '@/helpers/reportError';
import { useSaveShortcut } from '@/hooks/useSaveShortcut';
import { useSchemaScopeAccess } from '@/hooks/useSchemaScopeAccess';
import { draftKeyOf, useDefinitionDraftStore } from '@/stores/definitionDraft';
import { useSchemaLock } from '../../hooks/useSchemaLock';
import { useSharedReadOnly } from '../../hooks/useSharedReadOnly';
import { LockNotice } from '../../LockNotice';
import { SharedNotice } from '../../SharedNotice';
import { ActionFooter } from '../ActionFooter';
import { ChangeProgress } from '../ChangeProgress';
import { Scope } from '../DefinitionPanel/Scope';
import { FieldList } from '../FieldList';
import { FieldPanel } from '../FieldPanel';
import { Header } from '../Header';
import { useDraftIssues } from '../hooks/useDraftIssues';
import { useIsDraftDirty } from '../hooks/useIsDraftDirty';
import { useNewField } from '../hooks/useNewField';
import { useReloadDraft } from '../hooks/useReloadDraft';
import { useRemoteChangeNotice } from '../hooks/useRemoteChangeNotice';
import { useSaveFlow } from '../hooks/useSaveFlow';
import { useSelectedField } from '../hooks/useSelectedField';
import { ModelSettings } from '../ModelSettings';
import { NoFieldSelected } from '../NoFieldSelected';
import { RemoteChangeBanner } from '../RemoteChangeBanner';
import { ReviewSheet } from '../ReviewSheet';

type EditorProps = { category: DefinitionCategory; id: string; detail: DefinitionDetail };

/** Edits a draft of the definition; nothing changes on the server until the plan is reviewed and applied. */
export const Editor = ({ category, id, detail }: EditorProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const key = draftKeyOf(category, id);
  const loadedKey = useDefinitionDraftStore((state) => state.key);
  const draft = useDefinitionDraftStore((state) => state.draft);
  const base = useDefinitionDraftStore((state) => state.base);
  const baseVersion = useDefinitionDraftStore((state) => state.baseVersion);
  const load = useDefinitionDraftStore((state) => state.load);
  const reset = useDefinitionDraftStore((state) => state.reset);
  const reloadDraft = useReloadDraft(category, id);
  const flow = useSaveFlow(category, id, reloadDraft);
  const dirty = useIsDraftDirty();
  const { issues } = useDraftIssues();
  const { field, index } = useSelectedField();
  const { locked, reason } = useSchemaLock();
  const sharedReadOnly = useSharedReadOnly(detail.scope);
  const { multiSite } = useSchemaScopeAccess();
  const deleteDefinition = useDeleteDefinition();
  const newField = useNewField();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [dismissedChangeId, setDismissedChangeId] = useState<string | undefined>(undefined);
  const [scopeConflict, setScopeConflict] = useState(false);

  // A fresh draft each time the builder opens; it is forgotten when the builder closes.
  const initial = useRef(detail);
  useEffect(() => {
    load(category, initial.current.definition, initial.current.version);
    return reset;
  }, [key, category, load, reset]);

  const changeId = flow.runningChangeId ?? detail.pendingChange?.id;
  const visibleChangeId = changeId === dismissedChangeId ? undefined : changeId;
  const changeRunning = visibleChangeId !== undefined;
  const { changedElsewhere } = useRemoteChangeNotice(id, baseVersion, changeRunning || flow.applying);
  const saveBlocked = locked || sharedReadOnly || changeRunning;
  const canReview = dirty && issues.length === 0 && !saveBlocked && !flow.reviewing;
  const planOpen = flow.state.step === 'review';
  const conflict = flow.state.step === 'conflict' || scopeConflict;
  useSaveShortcut(() => void flow.review(), canReview && !planOpen);

  if (loadedKey !== key || !draft) {
    return <LoadingState />;
  }

  const reload = (mode: 'replace' | 'rebase') =>
    void reloadDraft(mode).catch((error: unknown) => {
      logError(error, 'reloading the definition');
      toast.error(describeError(error));
    });
  const editingDisabled = locked || sharedReadOnly;

  const scopeSection = multiSite ? (
    <Scope
      category={category}
      id={id}
      label={draft.label}
      scope={detail.scope}
      blocked={dirty || changeRunning || flow.applying}
      locked={locked}
      onConflict={() => setScopeConflict(true)}
    />
  ) : null;

  const saveActions = {
    canDiscard: dirty,
    canReview,
    reviewing: flow.reviewing,
    onReview: () => void flow.review(),
    onDiscard: () => {
      if (base) {
        load(category, base, baseVersion);
      }
    },
  };

  return (
    <Page width="full">
      <UnsavedChangesGuard when={dirty} />
      <Header
        {...saveActions}
        draft={draft}
        version={baseVersion}
        dirty={dirty}
        issueCount={issues.length}
        deleteBlocked={saveBlocked}
        onDelete={() => setConfirmingDelete(true)}
      />
      {locked ? <LockNotice reason={reason} /> : null}
      {sharedReadOnly ? <SharedNotice /> : null}
      {changedElsewhere || conflict ? (
        <RemoteChangeBanner
          key={conflict ? 'conflict' : 'remote'}
          reason={conflict ? 'conflict' : 'remote'}
          dirty={dirty}
          onReload={() => {
            flow.resetStep();
            setScopeConflict(false);
            reload('replace');
          }}
          onKeepEdits={() => {
            flow.resetStep();
            setScopeConflict(false);
            reload('rebase');
          }}
        />
      ) : null}
      {visibleChangeId ? (
        <ChangeProgress
          key={visibleChangeId}
          changeId={visibleChangeId}
          onFinished={(status) => void flow.onChangeFinished(status)}
          onDismiss={() => {
            setDismissedChangeId(visibleChangeId);
            flow.dismissChange();
          }}
        />
      ) : null}
      {/*
        One column below xl: settings, fields, then the properties pane (shown for a selected field).
        Locked (or shared and not ours to change): every control is disabled individually, so fields can
        still be selected and read.
      */}
      <div className="grid min-w-0 gap-6 xl:grid-cols-[22.5rem_minmax(0,1fr)] xl:items-start">
        <div className="min-w-0 space-y-6">
          <ModelSettings issues={issues} disabled={editingDisabled} scopeSection={scopeSection} />
          <FieldList issues={issues} disabled={editingDisabled} onAdd={newField.add} />
        </div>
        {field ? (
          <FieldPanel
            key={field.id}
            field={field}
            index={index}
            issues={issues}
            disabled={editingDisabled}
            untouched={newField.isUntouched(field)}
            onDiscard={() => newField.discard(field.id)}
          />
        ) : (
          <NoFieldSelected hasFields={draft.fields.length > 0} />
        )}
      </div>
      <ActionFooter {...saveActions} />
      <ReviewSheet
        preview={flow.state.step === 'review' ? flow.state.preview : undefined}
        before={base}
        after={draft}
        applying={flow.applying}
        error={flow.applyError}
        onApply={(acknowledgement) => void flow.confirm(acknowledgement)}
        onClose={flow.resetStep}
      />
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t('models.builder.deleteTitle', { label: draft.label })}
        description={t('models.builder.deleteDescription')}
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={() =>
          deleteDefinition.mutate(
            { category, id, expectedVersion: baseVersion },
            {
              onSuccess: () => {
                reset();
                toast.success(t('models.deleted'));
                void navigate({ to: '/models' });
              },
            },
          )
        }
      />
    </Page>
  );
};
