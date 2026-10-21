import type { FieldDefinition } from '@shapio/schema';
import type { ContentQuery, FilterNode, FilterTarget, PopulateTree, SortTerm } from './types.js';

/**
 * A query parsed against an interface's contract, rewritten for one member (plan interfaces, decision 2).
 * Members hold the contract's fields under their own field IDs (BlogPost's `title` and Guide's `title` are
 * different fields), so every field the query names (filter and sort targets, the search field, `fields`,
 * `populate` keys) becomes the member's own field; everything else is kept. `fieldFor` maps a contract field
 * to the member's (`DefinitionIndex.memberFieldOf`); the contract guarantees one exists, so a missing one is
 * a bug and throws.
 */
export type MemberFieldLookup = (contractField: FieldDefinition) => FieldDefinition | undefined;

const mapped = (fieldFor: MemberFieldLookup, contractField: FieldDefinition): FieldDefinition => {
  const field = fieldFor(contractField);
  if (!field) {
    throw new Error(`No member field satisfies the contract field "${contractField.apiKey}"`);
  }
  return field;
};

const mapTarget = (fieldFor: MemberFieldLookup, target: FilterTarget): FilterTarget =>
  target.kind === 'field' ? { kind: 'field', field: mapped(fieldFor, target.field) } : target;

const mapFilter = (fieldFor: MemberFieldLookup, node: FilterNode): FilterNode => {
  switch (node.kind) {
    case 'and':
    case 'or':
      return { ...node, nodes: node.nodes.map((child) => mapFilter(fieldFor, child)) };
    case 'not':
      return { ...node, node: mapFilter(fieldFor, node.node) };
    case 'condition':
      return { ...node, target: mapTarget(fieldFor, node.target) };
  }
};

const mapSort = (fieldFor: MemberFieldLookup, terms: readonly SortTerm[]): SortTerm[] =>
  terms.map((term) => ({ ...term, target: mapTarget(fieldFor, term.target) }));

/**
 * Populate keys are relation field IDs at the top level only: what lies below a relation is the target's,
 * which is the same model for every member (the contract fixes a relation's target).
 */
const mapPopulate = (
  fieldFor: MemberFieldLookup,
  contractFields: readonly FieldDefinition[],
  tree: PopulateTree,
): PopulateTree =>
  new Map(
    [...tree].map(([fieldId, subtree]) => {
      const contractField = contractFields.find((field) => field.id === fieldId);
      return [contractField ? mapped(fieldFor, contractField).id : fieldId, subtree] as const;
    }),
  );

export const memberQuery = (
  query: ContentQuery,
  contractFields: readonly FieldDefinition[],
  fieldFor: MemberFieldLookup,
): ContentQuery => ({
  ...query,
  filter: query.filter ? mapFilter(fieldFor, query.filter) : null,
  search: query.search ? { ...query.search, field: mapped(fieldFor, query.search.field) } : null,
  sort: mapSort(fieldFor, query.sort),
  fields: query.fields ? query.fields.map((field) => mapped(fieldFor, field)) : null,
  populate: mapPopulate(fieldFor, contractFields, query.populate),
});
