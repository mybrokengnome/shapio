import type { DefinitionListItem, DefinitionScope } from '@shapio/client';
import {
  foldApiKey,
  isInterfaceDefinition,
  type DefinitionIndex,
  type FieldDefinition,
  type InterfaceDefinition,
  type SchemaDefinition,
  type ValidationIssue,
} from '@shapio/schema';
import { newStableId } from '@/helpers/stableId';

/**
 * Interfaces in the builder and the create form (plan interfaces D11): which ones a type may implement,
 * copies of contract fields for a type that starts implementing one, and where a type's membership comes
 * from.
 */

type Placement = { scope: DefinitionScope; siteId: string | null };

/**
 * The interfaces a type in `placement` may implement, by label: shared ones always, a site's own only for a
 * type on that site (a shared type implements shared interfaces only; plan interfaces D3).
 */
export const interfacesInScope = (
  items: readonly DefinitionListItem[],
  placement: Placement,
): InterfaceDefinition[] =>
  items
    .filter(
      (item) =>
        item.scope === 'network' ||
        (placement.scope === 'site' && placement.siteId !== null && item.siteId === placement.siteId),
    )
    .flatMap(({ definition }) => (isInterfaceDefinition(definition) ? [definition] : []))
    .sort((a, b) => a.label.localeCompare(b.label));

/**
 * A member's copy of a contract field: the same field under a fresh stable ID (fields never share IDs across
 * definitions), localized only when the type is.
 */
export const copyContractField = (field: FieldDefinition, localized: boolean): FieldDefinition => ({
  ...field,
  id: newStableId(),
  localized: localized && field.localized,
});

/**
 * Copies of the contract fields of `contracts` that `existing` lacks (by API ID, case-folded), each once, in
 * contract order: what a new type needs to be valid at once.
 */
export const contractFieldCopies = (
  contracts: readonly InterfaceDefinition[],
  existing: readonly Pick<FieldDefinition, 'apiKey'>[],
  localized: boolean,
): FieldDefinition[] => {
  const taken = new Set(existing.map((field) => foldApiKey(field.apiKey)));
  return contracts.flatMap((contract) =>
    contract.fields.flatMap((field) => {
      const key = foldApiKey(field.apiKey);
      if (taken.has(key)) {
        return [];
      }
      taken.add(key);
      return [copyContractField(field, localized)];
    }),
  );
};

/** One interface a type is a member of: directly, or through the ancestor `via` (its ID). */
export type Membership = { interfaceId: string; via?: string };

/**
 * The interfaces `modelId` implements, each with the ancestor it comes from when inherited. `own` is the
 * type's own `implements` (the draft's, which may differ from the active index).
 */
export const membershipsOf = (
  index: DefinitionIndex,
  modelId: string,
  own: readonly string[],
): Membership[] => {
  const inherited = index
    .ancestors(modelId)
    .flatMap((ancestorId) => {
      const ancestor = index.get(ancestorId);
      const ids = ancestor && 'implements' in ancestor ? (ancestor.implements ?? []) : [];
      return ids.map((interfaceId) => ({ interfaceId, via: ancestorId }));
    })
    .filter(
      (entry, position, all) =>
        all.findIndex((other) => other.interfaceId === entry.interfaceId) === position,
    );
  const inheritedIds = new Set(inherited.map((entry) => entry.interfaceId));
  return [...inherited, ...own.filter((id) => !inheritedIds.has(id)).map((interfaceId) => ({ interfaceId }))];
};

/** A model's own `implements` (none for components and interfaces). */
export const ownImplementsOf = (definition: SchemaDefinition | null | undefined): readonly string[] =>
  definition && (definition.kind === 'collection' || definition.kind === 'singleton')
    ? (definition.implements ?? [])
    : [];

/**
 * A member that lacks a contract field: the definition it is reported on (the type that declares
 * `implements`), the interface and the field's API ID, and the site whose view found it (every-site admins
 * only; see the API's scoped validation).
 */
export type MissingContractIssue = {
  code: 'INTERFACE_FIELD_MISSING';
  path: string;
  message: string;
  definitionId?: string;
  interfaceId: string;
  fieldApiKey: string;
  siteKey?: string;
};

/** What a validation issue may carry, from the client's validators or a 422 SCHEMA_INVALID. */
type IssueLike = Pick<ValidationIssue, 'path' | 'message'> & {
  code: string;
  definitionId?: string;
  interfaceId?: string;
  fieldApiKey?: string;
  siteKey?: string;
};

/**
 * The `INTERFACE_FIELD_MISSING` issues among `issues` (they name the interface and the contract field), each
 * member and field once.
 */
export const missingContractIssues = (issues: readonly IssueLike[]): MissingContractIssue[] => {
  const seen = new Set<string>();
  return issues.flatMap((found) => {
    if (
      found.code !== 'INTERFACE_FIELD_MISSING' ||
      found.interfaceId === undefined ||
      found.fieldApiKey === undefined
    ) {
      return [];
    }
    const key = `${found.definitionId ?? ''} ${found.fieldApiKey}`;
    if (seen.has(key)) {
      return [];
    }
    seen.add(key);
    return [
      {
        code: 'INTERFACE_FIELD_MISSING' as const,
        path: found.path,
        message: found.message,
        definitionId: found.definitionId,
        interfaceId: found.interfaceId,
        fieldApiKey: found.fieldApiKey,
        ...(found.siteKey === undefined ? {} : { siteKey: found.siteKey }),
      },
    ];
  });
};
