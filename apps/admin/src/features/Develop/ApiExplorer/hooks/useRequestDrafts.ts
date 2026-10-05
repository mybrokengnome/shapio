import { useCallback, useState } from 'react';
import { EMPTY_DRAFT, type RequestDraft } from '../helpers/request';

/**
 * The request builder's values per REST operation, kept while switching endpoints and tabs (in memory, this
 * visit only): the REST tab edits them, the GraphQL tab builds the same request as a query. The token is
 * not part of a draft: it lives in the explorer's token store.
 */
export const useRequestDrafts = () => {
  const [drafts, setDrafts] = useState<Readonly<Record<string, RequestDraft>>>({});
  const draftOf = useCallback(
    (operationId: string | undefined) => (operationId && drafts[operationId]) || EMPTY_DRAFT,
    [drafts],
  );
  const setDraft = useCallback((operationId: string, next: RequestDraft) => {
    setDrafts((current) => ({ ...current, [operationId]: next }));
  }, []);
  return { draftOf, setDraft };
};
