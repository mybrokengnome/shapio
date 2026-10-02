import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { FileCode2, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSchemaVersion } from '@/api/schema';
import { EmptyState } from '@/components/EmptyState';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { UnsavedChangesGuard, type GuardedNavigation } from '@/components/UnsavedChangesGuard';
import { Conflicts } from './Conflicts';
import { FileNav } from './FileNav';
import { LOCK_PATH } from './helpers/files';
import type { GuardConflict } from './helpers/guard';
import { useApplyFiles } from './hooks/useApplyFiles';
import { useSchemaWorkspace, type SchemaWorkspace } from './hooks/useSchemaWorkspace';
import { LockFile } from './LockFile';
import { Workbench } from './Workbench';

const route = getRouteApi('/app/schema');

/** Switching files (`?file=`) keeps the edits in the workspace; only leaving the screen asks. */
const leavesScreen = ({ currentPath, nextPath }: GuardedNavigation) => currentPath !== nextPath;

/**
 * Schema as code (plan developer-face §2): the files `shapio schema pull` writes, edited in the browser
 * with completion and the server's own validation, previewed (form, REST, GraphQL, types, plan) and
 * applied as schema drafts of the open change set, behind the same three-way guard as the CLI.
 */
export const Schema = () => {
  const { t } = useTranslation();
  const { query, workspace } = useSchemaWorkspace();
  return (
    <Page width="full">
      <QueryView query={query}>
        {() =>
          workspace ? (
            <SchemaFiles workspace={workspace} />
          ) : (
            <EmptyState icon={FileCode2} title={t('develop.schemaTitle')} />
          )
        }
      </QueryView>
    </Page>
  );
};

type SchemaFilesProps = { workspace: SchemaWorkspace };

const SchemaFiles = ({ workspace }: SchemaFilesProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { file: openPath } = route.useSearch();
  const liveVersion = useSchemaVersion().data;
  const [conflicts, setConflicts] = useState<GuardConflict[]>([]);
  const [appliedTo, setAppliedTo] = useState<string>();
  const { files, dirtyFiles } = workspace;
  const dirty = dirtyFiles.length > 0 && appliedTo === undefined;
  const applyFiles = useApplyFiles({
    onInvalid: (file) => void navigate({ to: '/schema', search: { file: file.path } }),
    onConflict: setConflicts,
    onApplied: setAppliedTo,
  });

  // After applying, the edits live in the change set: leave for its review once the guard has let go.
  useEffect(() => {
    if (appliedTo) {
      void navigate({ to: '/changes/$changeSetId', params: { changeSetId: appliedTo } });
    }
  }, [appliedTo, navigate]);

  const openFile =
    files.find((file) => file.path === openPath) ?? (openPath === LOCK_PATH ? undefined : files[0]);
  const showLock = openPath === LOCK_PATH || files.length === 0;
  const moved = liveVersion !== undefined && liveVersion !== workspace.schemaVersion;
  const conflictText = (conflict: GuardConflict) => workspace.textOf(conflict.file);
  const resolve = (definitionId: string) =>
    setConflicts((current) => current.filter((conflict) => conflict.file.definitionId !== definitionId));

  const reloadButton = (
    <Button type="button" variant="outline" disabled={applyFiles.pending}>
      <RefreshCw aria-hidden="true" />
      {t('develop.schema.reload')}
    </Button>
  );
  return (
    <>
      <PageHeader
        title={t('develop.schemaTitle')}
        meta={t('develop.schema.meta', { version: workspace.schemaVersion, count: files.length })}
        actions={
          <>
            {dirty ? (
              <InlineConfirm
                tone="danger"
                title={t('develop.schema.reloadTitle')}
                description={t('develop.schema.reloadDescription')}
                confirmLabel={t('develop.schema.reload')}
                onConfirm={() => {
                  setConflicts([]);
                  return workspace.reload();
                }}
                trigger={reloadButton}
              />
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={applyFiles.pending}
                onClick={() => {
                  setConflicts([]);
                  void workspace.reload();
                }}
              >
                <RefreshCw aria-hidden="true" />
                {t('develop.schema.reload')}
              </Button>
            )}
            <Button
              type="button"
              disabled={!dirty || applyFiles.pending}
              onClick={() => {
                setConflicts([]);
                void applyFiles.apply(workspace);
              }}
            >
              {applyFiles.pending
                ? t('develop.schema.applying')
                : t('develop.schema.apply.label', { count: dirtyFiles.length })}
            </Button>
          </>
        }
      />
      {moved ? (
        <Alert variant="info" role="status">
          <AlertDescription>
            {t('develop.schema.moved', { loaded: workspace.schemaVersion, live: liveVersion })}
          </AlertDescription>
        </Alert>
      ) : null}
      {conflicts.length > 0 ? (
        <Conflicts
          conflicts={conflicts}
          textOf={conflictText}
          onTakeRemote={(remote) => {
            workspace.takeRemote(remote);
            resolve(remote.definition.id);
          }}
          onKeepLocal={(remote) => {
            workspace.keepLocal(remote);
            resolve(remote.definition.id);
          }}
        />
      ) : null}
      <div className="flex flex-col gap-6 lg:flex-row">
        <FileNav
          files={files}
          openPath={showLock || !openFile ? LOCK_PATH : openFile.path}
          isDirty={workspace.isDirty}
        />
        <div className="min-w-0 flex-1">
          {showLock || !openFile ? (
            <LockFile text={workspace.lockText} />
          ) : (
            <Workbench key={openFile.definitionId} file={openFile} workspace={workspace} />
          )}
        </div>
      </div>
      <UnsavedChangesGuard when={dirty} shouldBlock={leavesScreen} />
    </>
  );
};
