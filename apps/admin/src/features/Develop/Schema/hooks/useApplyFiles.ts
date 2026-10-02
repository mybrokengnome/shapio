import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSaveDraftToChangeSet } from '@/api/changeSets';
import { schemaExportQueryOptions, type SchemaDraftInput } from '@/api/schemaFiles';
import { reportError } from '@/helpers/reportError';
import { analyzeFile } from '../helpers/analyze';
import type { SchemaFile } from '../helpers/files';
import { guardApply, type GuardConflict, type GuardItem } from '../helpers/guard';
import type { SchemaWorkspace } from './useSchemaWorkspace';

type ApplyFilesOptions = {
  /** A changed file that does not validate: the screen opens it. */
  onInvalid: (file: SchemaFile) => void;
  onConflict: (conflicts: GuardConflict[]) => void;
  /** The drafts are in the change set: the screen goes to its review. */
  onApplied: (changeSetId: string) => void;
};

/** Validated local definitions of every changed file, or the first file that does not validate. */
const localItems = (workspace: SchemaWorkspace): { items: GuardItem[] } | { invalid: SchemaFile } => {
  const items: GuardItem[] = [];
  for (const file of workspace.dirtyFiles) {
    const analysis = analyzeFile(workspace.textOf(file), {
      previous: file.base.definition,
      others: workspace.definitions.filter((definition) => definition.id !== file.definitionId),
    });
    if (analysis.status !== 'valid') {
      return { invalid: file };
    }
    items.push({ file, local: { definition: analysis.definition } });
  }
  return { items };
};

/**
 * "Apply": validates the changed files, runs the three-way guard against the instance as it is now
 * (refusing with the diff when a definition moved on both sides), then writes the files as schema drafts
 * of the open change set. Nothing goes live until the set ships from its review.
 */
export const useApplyFiles = ({ onInvalid, onConflict, onApplied }: ApplyFilesOptions) => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const saveDraft = useSaveDraftToChangeSet();
  const [checking, setChecking] = useState(false);

  /** One draft per definition into the newest open set (the first call creates it when none is open). */
  const saveDrafts = async (drafts: readonly SchemaDraftInput[]) => {
    let changeSetId = '';
    for (const { definitionId, ...input } of drafts) {
      changeSetId = await saveDraft.mutateAsync({
        definitionId,
        input,
        newSetTitle: t('develop.schema.apply.newSetTitle'),
      });
    }
    return changeSetId;
  };

  const apply = async (workspace: SchemaWorkspace) => {
    setChecking(true);
    try {
      const local = localItems(workspace);
      if ('invalid' in local) {
        toast.error(t('develop.schema.apply.invalid', { path: local.invalid.path }));
        onInvalid(local.invalid);
        return;
      }
      const remote = await queryClient.fetchQuery(schemaExportQueryOptions);
      const result = guardApply(local.items, remote);
      if (result.status === 'conflict') {
        onConflict(result.conflicts);
        return;
      }
      if (result.drafts.length === 0) {
        toast.info(t('develop.schema.apply.nothing'));
        return;
      }
      onApplied(await saveDrafts(result.drafts));
    } catch (error) {
      reportError(error, 'apply schema files');
    } finally {
      setChecking(false);
    }
  };

  return { apply, pending: checking };
};
