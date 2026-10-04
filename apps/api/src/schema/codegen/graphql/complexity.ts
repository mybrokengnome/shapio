import {
  getNamedType,
  GraphQLError,
  isInterfaceType,
  isObjectType,
  Kind,
  OperationTypeNode,
  type ASTVisitor,
  type DefinitionNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type GraphQLField,
  type GraphQLNamedType,
  type GraphQLSchema,
  type OperationDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
  type ValueNode as AstValueNode,
} from 'graphql';
import { QUERY_LIMITS } from '../../../content/compiler/types.js';

/**
 * Depth and cost limits (ADR 0006), as one GraphQL validation rule so results are cached with the parsed
 * query (documentCache.ts keys that cache by schema, so a new schema starts empty). Introspection (`__schema`,
 * `__type`) is exempt from both: it is bounded by the schema, and whether a caller may introspect at all is
 * decided per request (plugins/graphql.ts).
 *
 * Cost: every selected field costs its weight (1 unless it declares one), multiplied by the sizes of the
 * lists it sits in. A collection query weighs its `pageSize` (the rows it reads; the REST default when
 * omitted, the REST maximum when it comes from a variable without a default), its `nodes` multiply their
 * children by that page size, and `totalCount` (a COUNT query) weighs TOTAL_COUNT_COST. Many-relations and
 * `localizations` count as fixed list estimates. Fields declare these through `extensions.cost`.
 *
 * Aliases: at most MAX_ALIASES_PER_SELECTION aliased fields in one selection set, so one request cannot
 * repeat an expensive root field thousands of times within the budget.
 */
export const PAGE_SIZE_ARGUMENT = 'pageSize';
/** Estimated size of a many-relation's target list. */
export const RELATION_LIST_COST = 10;
/** A `totalCount` runs a COUNT over the filtered rows. */
export const TOTAL_COUNT_COST = 10;
export const MAX_ALIASES_PER_SELECTION = 30;

type CostExtension = {
  list?: number | 'pageSize';
  pageSizeArgument?: string;
  /** The field's own cost (default 1); `pageSize` = the page size it reads. */
  weight?: number | 'pageSize';
};

type Walk = {
  schema: GraphQLSchema;
  fragments: ReadonlyMap<string, FragmentDefinitionNode>;
  variables: OperationDefinitionNode['variableDefinitions'];
  /**
   * Each fragment's measure at multiplier 1, by fragment and inherited page size. Cost is linear in the
   * multiplier, so a fragment is walked once however often it is spread; without this, fragments that
   * spread the next one twice (a "fragment bomb") would make the walk exponential.
   */
  fragmentMeasures: Map<string, Measure>;
};

const INTROSPECTION_ROOTS: ReadonlySet<string> = new Set(['__schema', '__type']);

const costOf = (field: GraphQLField<unknown, unknown>): CostExtension =>
  (field.extensions as { cost?: CostExtension } | undefined)?.cost ?? {};

const intValue = (walk: Walk, value: AstValueNode | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }
  if (value.kind === Kind.INT) {
    return Number(value.value);
  }
  if (value.kind === Kind.VARIABLE) {
    const definition = walk.variables?.find(
      (candidate) => candidate.variable.name.value === value.name.value,
    );
    return definition?.defaultValue?.kind === Kind.INT
      ? Number(definition.defaultValue.value)
      : QUERY_LIMITS.maxPageSize;
  }
  return undefined;
};

const pageSizeOf = (walk: Walk, node: FieldNode, argument: string): number => {
  const given = intValue(walk, node.arguments?.find((arg) => arg.name.value === argument)?.value);
  return Math.min(Math.max(given ?? QUERY_LIMITS.defaultPageSize, 1), QUERY_LIMITS.maxPageSize);
};

type Measure = { cost: number; depth: number };

const measureSelections = (
  walk: Walk,
  parent: GraphQLNamedType | undefined,
  selectionSet: SelectionSetNode,
  multiplier: number,
  pageSize: number,
  visiting: ReadonlySet<string>,
): Measure => {
  let cost = 0;
  let depth = 0;
  for (const selection of selectionSet.selections) {
    let measured: Measure = { cost: 0, depth: 0 };
    if (selection.kind === Kind.FIELD) {
      measured = measureField(walk, parent, selection, multiplier, pageSize, visiting);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      const type = selection.typeCondition ? walk.schema.getType(selection.typeCondition.name.value) : parent;
      measured = measureSelections(
        walk,
        type ?? undefined,
        selection.selectionSet,
        multiplier,
        pageSize,
        visiting,
      );
    } else {
      const name = selection.name.value;
      const fragment = walk.fragments.get(name);
      // Cycles are rejected by the standard NoFragmentCycles rule; never follow one here.
      if (fragment && !visiting.has(name)) {
        const key = `${name}\u0000${pageSize}`;
        let unit = walk.fragmentMeasures.get(key);
        if (!unit) {
          const type = walk.schema.getType(fragment.typeCondition.name.value) ?? undefined;
          unit = measureSelections(
            walk,
            type,
            fragment.selectionSet,
            1,
            pageSize,
            new Set([...visiting, name]),
          );
          walk.fragmentMeasures.set(key, unit);
        }
        measured = { cost: unit.cost * multiplier, depth: unit.depth };
      }
    }
    cost += measured.cost;
    depth = Math.max(depth, measured.depth);
  }
  return { cost, depth };
};

function measureField(
  walk: Walk,
  parent: GraphQLNamedType | undefined,
  node: FieldNode,
  multiplier: number,
  pageSize: number,
  visiting: ReadonlySet<string>,
): Measure {
  const name = node.name.value;
  if (name.startsWith('__')) {
    return { cost: 0, depth: 0 };
  }
  const field =
    parent && (isObjectType(parent) || isInterfaceType(parent)) ? parent.getFields()[name] : undefined;
  if (!field) {
    return { cost: multiplier, depth: 1 };
  }
  const extension = costOf(field);
  const childPageSize = extension.pageSizeArgument
    ? pageSizeOf(walk, node, extension.pageSizeArgument)
    : pageSize;
  const listSize = extension.list === 'pageSize' ? pageSize : (extension.list ?? 1);
  const own = multiplier * (extension.weight === 'pageSize' ? childPageSize : (extension.weight ?? 1));
  if (!node.selectionSet) {
    return { cost: own, depth: 1 };
  }
  const children = measureSelections(
    walk,
    getNamedType(field.type),
    node.selectionSet,
    multiplier * listSize,
    childPageSize,
    visiting,
  );
  return { cost: own + children.cost, depth: 1 + children.depth };
}

/**
 * Whether an operation selects introspection roots (directly or through fragments). Each fragment is
 * checked once (`checked` remembers the answer), so repeated spreads cannot make this exponential.
 */
export const selectsIntrospection = (
  selectionSet: SelectionSetNode,
  fragments: ReadonlyMap<string, FragmentDefinitionNode>,
  visiting: ReadonlySet<string> = new Set(),
  checked: Map<string, boolean> = new Map(),
): boolean =>
  selectionSet.selections.some((selection) => {
    if (selection.kind === Kind.FIELD) {
      return INTROSPECTION_ROOTS.has(selection.name.value);
    }
    if (selection.kind === Kind.INLINE_FRAGMENT) {
      return selectsIntrospection(selection.selectionSet, fragments, visiting, checked);
    }
    const name = selection.name.value;
    const fragment = fragments.get(name);
    if (fragment === undefined || visiting.has(name)) {
      return false;
    }
    const known = checked.get(name);
    if (known !== undefined) {
      return known;
    }
    const found = selectsIntrospection(
      fragment.selectionSet,
      fragments,
      new Set([...visiting, name]),
      checked,
    );
    checked.set(name, found);
    return found;
  });

export const fragmentsOf = (definitions: readonly DefinitionNode[]): Map<string, FragmentDefinitionNode> =>
  new Map(
    definitions
      .filter(
        (definition): definition is FragmentDefinitionNode => definition.kind === Kind.FRAGMENT_DEFINITION,
      )
      .map((fragment) => [fragment.name.value, fragment]),
  );

export const measureOperation = (
  schema: GraphQLSchema,
  operation: OperationDefinitionNode,
  fragments: ReadonlyMap<string, FragmentDefinitionNode>,
): Measure => {
  const root =
    operation.operation === OperationTypeNode.MUTATION
      ? schema.getMutationType()
      : operation.operation === OperationTypeNode.SUBSCRIPTION
        ? schema.getSubscriptionType()
        : schema.getQueryType();
  return measureSelections(
    { schema, fragments, variables: operation.variableDefinitions, fragmentMeasures: new Map() },
    root ?? undefined,
    operation.selectionSet,
    1,
    QUERY_LIMITS.defaultPageSize,
    new Set(),
  );
};

export const createLimitsRule =
  (limits: { maxDepth: number; maxComplexity: number }) =>
  (context: ValidationContext): ASTVisitor => {
    const fragments = fragmentsOf(context.getDocument().definitions);
    return {
      SelectionSet: (selectionSet) => {
        const aliases = selectionSet.selections.filter(
          (selection) => selection.kind === Kind.FIELD && selection.alias !== undefined,
        ).length;
        if (aliases > MAX_ALIASES_PER_SELECTION) {
          context.reportError(
            new GraphQLError(
              `A selection has ${aliases} aliased fields; the limit is ${MAX_ALIASES_PER_SELECTION}`,
              {
                nodes: [selectionSet],
                extensions: { code: 'QUERY_TOO_MANY_ALIASES', aliases, limit: MAX_ALIASES_PER_SELECTION },
              },
            ),
          );
        }
      },
      OperationDefinition: (operation) => {
        const { cost, depth } = measureOperation(context.getSchema(), operation, fragments);
        if (depth > limits.maxDepth) {
          context.reportError(
            new GraphQLError(`The query is ${depth} levels deep; the limit is ${limits.maxDepth}`, {
              nodes: [operation],
              extensions: { code: 'QUERY_TOO_DEEP', depth, limit: limits.maxDepth },
            }),
          );
        }
        if (cost > limits.maxComplexity) {
          context.reportError(
            new GraphQLError(`The query's estimated cost is ${cost}; the limit is ${limits.maxComplexity}`, {
              nodes: [operation],
              extensions: { code: 'QUERY_TOO_COMPLEX', cost, limit: limits.maxComplexity },
            }),
          );
        }
      },
    };
  };
