import { createDefinitionIndex, type DefinitionIndex } from '../inheritance/resolve.js';
import {
  isInterfaceDefinition,
  isModelDefinition,
  type FieldDefinition,
  type InterfaceDefinition,
  type ModelDefinition,
  type ResolvedField,
  type SchemaDefinition,
} from '../types/definitions.js';
import { issue, type ValidationIssue } from './issues.js';

/**
 * Cross-definition checks of interfaces (plan interfaces, D2). A collection or singleton that implements an
 * interface names existing interfaces, and its effective fields satisfy every contract field: same API ID
 * (exact), same data type, compatible settings, and every flag the contract sets. Issues are reported on the
 * member (the definition that implements), so deleting, renaming or retyping a member's field while it
 * implements the interface is refused with the interface named, and so is adding a contract field a member
 * lacks (the admin offers to add it: `interfaceId` and `fieldApiKey` say which).
 */

const withDefinition = (definition: SchemaDefinition, found: ValidationIssue): ValidationIssue => ({
  ...found,
  definitionId: definition.id,
});

/** Flags a contract field may set that each member's field must set too. */
const CONTRACT_FLAGS = ['required', 'public', 'filterable', 'sortable'] as const;

/**
 * What differs between a contract field and a member's field with the same API ID, in words; empty when
 * the member's field satisfies it. Lengths, ranges and other validation settings are not compared.
 */
export const contractMismatches = (contract: FieldDefinition, member: FieldDefinition): string[] => {
  if (contract.type !== member.type) {
    return [`must be a ${contract.type} field, not ${member.type}`];
  }
  const found: string[] = [];
  if (contract.type === 'enum' && member.type === 'enum') {
    const values = new Set(member.settings.values.map((entry) => entry.value));
    const missing = contract.settings.values.filter((entry) => !values.has(entry.value));
    if (missing.length > 0) {
      found.push(`must allow the values ${missing.map((entry) => `"${entry.value}"`).join(', ')}`);
    }
    if (contract.settings.multiple !== member.settings.multiple) {
      found.push(contract.settings.multiple ? 'must allow several values' : 'must allow one value only');
    }
  }
  if (contract.type === 'media' && member.type === 'media') {
    const allowed = contract.settings.allowedKinds;
    const own = member.settings.allowedKinds;
    if (allowed !== undefined && (own === undefined || own.some((kind) => !allowed.includes(kind)))) {
      found.push(`must allow only ${allowed.join(', ')} media`);
    }
    if (contract.settings.multiple !== member.settings.multiple) {
      found.push(contract.settings.multiple ? 'must allow several files' : 'must allow one file only');
    }
  }
  if (contract.type === 'relation' && member.type === 'relation') {
    if (contract.settings.target !== member.settings.target) {
      found.push('must relate to the same target');
    }
    if (contract.settings.cardinality !== member.settings.cardinality) {
      found.push(`must relate to ${contract.settings.cardinality === 'many' ? 'many entries' : 'one entry'}`);
    }
  }
  for (const flag of CONTRACT_FLAGS) {
    if (contract[flag] && !member[flag]) {
      found.push(`must be ${flag}`);
    }
  }
  return found;
};

/** The issue path of a member's field: its own field's, or the `implements` entry for an inherited one. */
const fieldPath = (definition: ModelDefinition, field: ResolvedField, implementsPath: string) => {
  const position = definition.fields.findIndex((own) => own.id === field.id);
  return field.inheritedFrom === undefined && position !== -1 ? `/fields/${position}` : implementsPath;
};

const contractIssues = (
  definition: ModelDefinition,
  contract: InterfaceDefinition,
  implementsPath: string,
  index: DefinitionIndex,
): ValidationIssue[] =>
  contract.fields.flatMap((required) => {
    const extra = { interfaceId: contract.id, fieldApiKey: required.apiKey };
    const field = index.memberFieldOf(contract.id, required.id, definition.id);
    if (!field) {
      return [
        {
          ...issue(
            implementsPath,
            'INTERFACE_FIELD_MISSING',
            `"${required.apiKey}" is required by ${contract.label}`,
          ),
          ...extra,
        },
      ];
    }
    const found = contractMismatches(required, field);
    return found.length === 0
      ? []
      : [
          {
            ...issue(
              fieldPath(definition, field, implementsPath),
              'INTERFACE_FIELD_MISMATCH',
              `"${field.apiKey}" ${found.join('; ')}, as ${contract.label} requires`,
            ),
            ...extra,
          },
        ];
  });

/** The problems of one model's own `implements` list. */
const memberIssues = (definition: ModelDefinition, index: DefinitionIndex): ValidationIssue[] =>
  (definition.implements ?? []).flatMap((interfaceId, position) => {
    const path = `/implements/${position}`;
    const target = index.get(interfaceId);
    if (!target) {
      return [issue(path, 'UNKNOWN_INTERFACE', 'implements an interface that does not exist')];
    }
    if (!isInterfaceDefinition(target)) {
      return [issue(path, 'INVALID_INTERFACE', `"${target.apiKey}" is a ${target.kind}, not an interface`)];
    }
    return contractIssues(definition, target, path, index);
  });

/**
 * Every interface problem of a schema (see the module comment). A model is checked against the interfaces it
 * declares itself; its kinds inherit those fields locked, so they comply when it does.
 */
export const checkInterfaces = (
  definitions: readonly SchemaDefinition[],
  index: DefinitionIndex = createDefinitionIndex(definitions),
): ValidationIssue[] =>
  definitions.flatMap((definition) =>
    isModelDefinition(definition)
      ? memberIssues(definition, index).map((found) => withDefinition(definition, found))
      : [],
  );

/**
 * Why an interface cannot be deleted: one `HAS_MEMBERS` issue per model that implements it, directly or
 * through an ancestor. Relations that target it are `findReferencingDefinitions`' (REFERENCED_DEFINITION).
 */
export const interfaceDeletionIssues = (
  definitions: readonly SchemaDefinition[],
  interfaceId: string,
  index: DefinitionIndex = createDefinitionIndex(definitions),
): ValidationIssue[] => {
  const contract = index.get(interfaceId);
  if (!contract || !isInterfaceDefinition(contract)) {
    return [];
  }
  return index.implementedBy(interfaceId).map((memberId) => ({
    ...issue(
      '',
      'HAS_MEMBERS',
      `"${index.get(memberId)?.apiKey ?? memberId}" implements "${contract.apiKey}"; remove it from the type's Implements first`,
    ),
    definitionId: interfaceId,
  }));
};
