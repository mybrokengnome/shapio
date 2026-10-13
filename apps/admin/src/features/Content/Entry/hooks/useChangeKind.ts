import type { AdminEntry } from '@shapio/client';
import type { ResolvedModelDefinition } from '@shapio/schema';
import { useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useMe } from '@/api/auth';
import { useChangeEntryKind, useKindChangePreview, type KindChangeVariables } from '@/api/content';
import { canOnModel } from '@/helpers/modelPermissions';
import { logError } from '@/helpers/reportError';
import { familyKindsOf } from '@/hooks/useResolvedDefinitions';
import type { ContentSchema } from '../../hooks/useContentSchema';

type UseChangeKindOptions = {
  schema: ContentSchema;
  model: ResolvedModelDefinition;
  /** The saved entry (null until it exists). */
  entry: AdminEntry | null;
  /** The locale the editor shows, kept in the new route. */
  locale: string | null;
  /** Unsaved edits: a kind change works on the saved entry only, so it waits for a save. */
  dirty: boolean;
  canUpdate: boolean;
};

/**
 * Moving the entry to another kind of its family (plan polymorphic-types D11): the kinds it may become
 * (every other family member the admin may create), the picked one's dry run (the fields whose values would
 * be dropped), and the change itself, which opens the entry under its new kind. Values are recoverable from
 * history, not from a toast, so there is no Undo.
 */
export const useChangeKind = ({ schema, model, entry, locale, dirty, canUpdate }: UseChangeKindOptions) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const family = useMemo(
    () => familyKindsOf(schema.models, schema.index, schema.index.rootOf(model.id)),
    [schema, model.id],
  );
  const targets = useMemo(
    () => family.filter((kind) => kind.id !== model.id && canOnModel(me, kind.id, 'create')),
    [family, model.id, me],
  );
  const [targetKey, setTargetKey] = useState<string>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const target = targets.find((kind) => kind.apiKey === targetKey);
  const variables: KindChangeVariables | undefined =
    entry && target && !dirty
      ? {
          id: entry.id,
          targetModelKey: target.apiKey,
          expectedVersion: entry.version,
          locale: model.localized ? entry.locale : null,
        }
      : undefined;
  const preview = useKindChangePreview(model.apiKey, variables);
  const change = useChangeEntryKind(model.apiKey);

  const run = () => {
    if (!variables || !target) {
      return;
    }
    change.mutate(variables, {
      onSuccess: (moved) => {
        setConfirmOpen(false);
        toast.success(t('entry.changeKind.done', { kind: target.label }));
        void navigate({
          to: '/content/$modelKey/$entryId',
          params: { modelKey: moved.target.modelKey, entryId: variables.id },
          search: locale ? { locale } : {},
        });
      },
      // Shown in the confirmation (a moved draft, a scheduled publication, an open change set).
      onError: (error) => logError(error, `changing the kind of ${model.apiKey}/${variables.id}`),
    });
  };

  return {
    /** The model is part of a family and the admin may edit the entry: the section shows. */
    available: entry !== null && canUpdate && family.length > 1,
    targets,
    target,
    pick: (key: string) => {
      setTargetKey(key);
      change.reset();
    },
    preview,
    confirmOpen,
    setConfirmOpen: (open: boolean) => {
      setConfirmOpen(open);
      if (!open) {
        change.reset();
      }
    },
    run,
    pending: change.isPending,
    error: change.error,
  };
};
