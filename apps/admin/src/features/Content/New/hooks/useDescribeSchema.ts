import type { SchemaDraftResult } from '@shapio/client';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProposeSchema } from '@/api/assist';
import { useSaveNewDefinitionsToChangeSet } from '@/api/changeSets';

/**
 * "Describe it": a description → proposed definitions (nothing written) → saved as schema drafts into a
 * change set, whose review opens next. Shipping them stays a person's decision there.
 */
export const useDescribeSchema = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [description, setDescription] = useState('');
  const [proposal, setProposal] = useState<SchemaDraftResult | null>(null);
  const propose = useProposeSchema();
  const save = useSaveNewDefinitionsToChangeSet();
  const run = () => {
    if (description.trim() === '') {
      return;
    }
    setProposal(null);
    save.reset();
    propose.mutate({ description: description.trim() }, { onSuccess: setProposal });
  };
  const discard = () => {
    setProposal(null);
    propose.reset();
    save.reset();
  };
  const addToChangeSet = () => {
    if (!proposal) {
      return;
    }
    save.mutate(
      {
        definitions: proposal.definitions,
        newSetTitle: t('assist.describe.setTitle', { model: proposal.model }),
      },
      {
        onSuccess: (changeSetId) => void navigate({ to: '/changes/$changeSetId', params: { changeSetId } }),
      },
    );
  };
  return {
    description,
    setDescription,
    proposal,
    run,
    discard,
    addToChangeSet,
    proposing: propose.isPending,
    proposeError: propose.error,
    adding: save.isPending,
    addError: save.error,
  };
};
