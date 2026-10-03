import type { AssistIssue } from '@shapio/client';
import { create } from 'zustand';

/** A locale draft an assist wrote (translate): shown with "Proposed by {model}" until dismissed. */
export type AssistProposal = { model: string; from: string; issues: readonly AssistIssue[] };

type AssistProposalsState = {
  proposals: Readonly<Record<string, AssistProposal>>;
  propose: (key: string, proposal: AssistProposal) => void;
  dismiss: (key: string) => void;
};

/** One entry locale (the document's locale; `-` for non-localized models). */
export const proposalKey = (modelKey: string, entryId: string, locale: string | null) =>
  `${modelKey}/${entryId}/${locale ?? '-'}`;

/**
 * Proposals awaiting review, by entry locale (client-only, for this page load). Kept outside the document
 * because opening the new locale reloads it.
 */
export const useAssistProposalsStore = create<AssistProposalsState>()((set) => ({
  proposals: {},
  propose: (key, proposal) => set((state) => ({ proposals: { ...state.proposals, [key]: proposal } })),
  dismiss: (key) =>
    set((state) => {
      const { [key]: _dismissed, ...rest } = state.proposals;
      return { proposals: rest };
    }),
}));
