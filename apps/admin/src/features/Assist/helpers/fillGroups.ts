import type { FieldProposal } from '@shapio/client';

/** The proposals of one entry locale: accepted together, so sibling required fields are saved at once. */
export type FillGroup = {
  key: string;
  entryId: string;
  modelKey: string;
  entryTitle: string | null;
  locale: string;
  proposals: FieldProposal[];
};

export const fillGroupKeyOf = (proposal: Pick<FieldProposal, 'entryId' | 'locale'>) =>
  `${proposal.entryId}:${proposal.locale}`;

/** Proposals grouped by entry locale, in the order the run listed them. */
export const fillGroupsOf = (proposals: readonly FieldProposal[]): FillGroup[] => {
  const groups = new Map<string, FillGroup>();
  for (const proposal of proposals) {
    const key = fillGroupKeyOf(proposal);
    const group = groups.get(key);
    if (group) {
      group.proposals.push(proposal);
    } else {
      groups.set(key, {
        key,
        entryId: proposal.entryId,
        modelKey: proposal.modelKey,
        entryTitle: proposal.entryTitle,
        locale: proposal.locale,
        proposals: [proposal],
      });
    }
  }
  return [...groups.values()];
};
