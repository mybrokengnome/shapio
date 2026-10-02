import {
  classifyChanges,
  diffDefinitions,
  type SchemaDefinition,
  type SyncConflictReason,
} from '@shapio/schema';
import { GitMerge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ExportedDefinition } from '@/api/schemaFiles';
import { CopyButton } from '@/components/CopyButton';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Panel } from '@/components/Panel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { describeChange } from '@/features/Models/helpers/describeChange';
import type { GuardConflict } from '../helpers/guard';

const REASON_KEYS = {
  changedOnBoth: 'develop.schema.conflicts.reasons.changedOnBoth',
  deletedOnTarget: 'develop.schema.conflicts.reasons.deletedOnTarget',
  existsOnTarget: 'develop.schema.conflicts.reasons.existsOnTarget',
  changedOnTargetBeforeDelete: 'develop.schema.conflicts.reasons.changedOnTargetBeforeDelete',
} as const satisfies Record<SyncConflictReason, string>;

type ChangeListProps = { label: string; before: SchemaDefinition; after: SchemaDefinition | null };

const ChangeList = ({ label, before, after }: ChangeListProps) => {
  const changes = classifyChanges(diffDefinitions(before, after), { before, after });
  return (
    <div className="min-w-0 space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {changes.map((change, index) => (
          <li key={`${change.kind}:${change.fieldId ?? ''}:${change.property ?? ''}:${index}`}>
            {describeChange(change, before, after)}
          </li>
        ))}
      </ul>
    </div>
  );
};

type ConflictsProps = {
  conflicts: readonly GuardConflict[];
  textOf: (conflict: GuardConflict) => string;
  onTakeRemote: (remote: ExportedDefinition) => void;
  onKeepLocal: (remote: ExportedDefinition) => void;
};

/**
 * Apply refused, like a rejected non-fast-forward push: these definitions changed on the instance since
 * the files were loaded. Per file, what changed there and here; the admin takes the instance's version or
 * keeps theirs on top of it (rebased), then applies again.
 */
export const Conflicts = ({ conflicts, textOf, onTakeRemote, onKeepLocal }: ConflictsProps) => {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <Alert variant="warning">
        <GitMerge aria-hidden="true" />
        <AlertTitle>{t('develop.schema.conflicts.title', { count: conflicts.length })}</AlertTitle>
        <AlertDescription>{t('develop.schema.conflicts.description')}</AlertDescription>
      </Alert>
      {conflicts.map((conflict) => {
        const { file, local, remote } = conflict;
        return (
          <Panel
            key={file.definitionId}
            title={t('develop.schema.conflicts.fileTitle', { path: file.path })}
            description={t(REASON_KEYS[conflict.reason])}
            actions={<CopyButton value={textOf(conflict)} />}
          >
            <div className="grid gap-5 md:grid-cols-2">
              <ChangeList
                label={t('develop.schema.conflicts.theirs')}
                before={file.base.definition}
                after={remote?.definition ?? null}
              />
              <ChangeList
                label={t('develop.schema.conflicts.yours')}
                before={file.base.definition}
                after={local.definition}
              />
            </div>
            {remote ? (
              <div className="mt-5 flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => onKeepLocal(remote)}>
                  {t('develop.schema.conflicts.keepLocal')}
                </Button>
                <InlineConfirm
                  tone="danger"
                  title={t('develop.schema.conflicts.takeRemoteTitle')}
                  description={t('develop.schema.conflicts.takeRemoteDescription')}
                  confirmLabel={t('develop.schema.conflicts.takeRemote')}
                  onConfirm={() => onTakeRemote(remote)}
                  trigger={
                    <Button type="button" size="sm" variant="outline">
                      {t('develop.schema.conflicts.takeRemote')}
                    </Button>
                  }
                />
              </div>
            ) : null}
          </Panel>
        );
      })}
    </div>
  );
};
