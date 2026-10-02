import { useState } from 'react';
import { EMPTY_DRAFT, type RequestDraft } from '../helpers/request';

/**
 * The request builder's values per operation, kept while switching endpoints (in memory, this visit only).
 * The token is not part of a draft: it lives in the explorer's token store.
 */
export const useRequestDraft = (operationId: string | undefined) => {
  const [drafts, setDrafts] = useState<Readonly<Record<string, RequestDraft>>>({});
  const draft = (operationId && drafts[operationId]) || EMPTY_DRAFT;
  const setDraft = (next: RequestDraft) => {
    if (operationId) {
      setDrafts((current) => ({ ...current, [operationId]: next }));
    }
  };
  return { draft, setDraft };
};
