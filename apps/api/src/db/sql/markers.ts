import {
  AliasNode,
  IdentifierNode,
  type AggregateFunctionNode,
  type FunctionNode,
  type OperationNode,
  type ParensNode,
  type RootOperationNode,
  type SelectionNode,
  type SelectQueryNode,
} from 'kysely';
import { markedResultType, type ResultType } from './typed.js';

/**
 * Result-type markers of a query's output columns (`typed.ts`), for drivers whose database does not report
 * the type of a computed column (SQLite) or reports one PostgreSQL would not (MySQL computes comparisons as
 * integers). Shared by the SQLite and MySQL plugins.
 */
const selectionsOf = (node: RootOperationNode): readonly SelectionNode[] | undefined => {
  switch (node.kind) {
    case 'SelectQueryNode':
      return node.selections;
    case 'InsertQueryNode':
    case 'UpdateQueryNode':
    case 'DeleteQueryNode':
      return node.returning?.selections;
    default:
      return undefined;
  }
};

/** Functions whose result has the type of their (marked) arguments. */
const TYPE_PRESERVING_FUNCTIONS = new Set(['coalesce', 'max', 'min', 'ifnull']);
/** Aggregates PostgreSQL returns as bigint/numeric, which its driver reads as decimal strings. */
const BIGINT_AGGREGATES = new Set(['count', 'sum']);

/**
 * The marker of an expression: its own, or one it inherits through `coalesce`/`max`/`min`, parentheses
 * and scalar subqueries (`coalesce((select asJson(…) …), emptyArray())` needs no second marker).
 * `count` and `sum` read as decimal strings, like PostgreSQL's bigint and numeric.
 */
const markerOf = (node: OperationNode | undefined): ResultType | undefined => {
  if (!node) {
    return undefined;
  }
  const own = markedResultType(node);
  if (own) {
    return own;
  }
  switch (node.kind) {
    case 'AliasNode':
      return markerOf((node as AliasNode).node);
    case 'ParensNode':
      return markerOf((node as ParensNode).node);
    case 'SelectionNode':
      return markerOf((node as SelectionNode).selection);
    case 'SelectQueryNode': {
      const selections = (node as SelectQueryNode).selections;
      return selections?.length === 1 ? markerOf(selections[0]) : undefined;
    }
    case 'AggregateFunctionNode':
    case 'FunctionNode': {
      const call = node as Partial<FunctionNode> & Partial<AggregateFunctionNode>;
      if (node.kind === 'AggregateFunctionNode' && BIGINT_AGGREGATES.has(String(call.func).toLowerCase())) {
        return 'bigint';
      }
      if (!TYPE_PRESERVING_FUNCTIONS.has(String(call.func).toLowerCase())) {
        return undefined;
      }
      for (const argument of call.aggregated ?? call.arguments ?? []) {
        const marker = markerOf(argument);
        if (marker) {
          return marker;
        }
      }
      return undefined;
    }
    default:
      return undefined;
  }
};

/** Output column name → marker, for top-level selections that are (or inherit) marked expressions. */
export const collectMarkers = (node: RootOperationNode): Map<string, ResultType> | undefined => {
  let markers: Map<string, ResultType> | undefined;
  for (const selection of selectionsOf(node) ?? []) {
    const aliased = selection.selection;
    if (!AliasNode.is(aliased) || !IdentifierNode.is(aliased.alias)) {
      continue;
    }
    const type = markerOf(aliased.node);
    if (type) {
      markers ??= new Map();
      markers.set(aliased.alias.name, type);
    }
  }
  return markers;
};
