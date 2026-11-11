import {
  BREAK,
  getArgumentValues,
  getVariableValues,
  GraphQLError,
  Kind,
  TypeInfo,
  visit,
  visitWithTypeInfo,
  type DocumentNode,
  type GraphQLSchema,
  type OperationDefinitionNode,
} from 'graphql';
import { MAX_BODY_DEPTH } from '../../../constants/requestBody.js';
import { AppError } from '../../../helpers/appError.js';
import { nestsDeeperThan } from '../../../helpers/jsonDepth.js';

/**
 * The body depth limit (`MAX_BODY_DEPTH`, plugins/textInput.ts) for what a GraphQL document writes itself: a
 * value written as a literal in the query text is a string in the request body, so the body's own limit never
 * counts it. graphql-js has no nesting limit of its own: its parser and value coercion recurse, so a document
 * thousands of levels deep would overflow the stack (a 500).
 *
 * - Before parsing, the document's bracket nesting (`{`, `[`, `(` outside strings and comments) is capped at
 *   `MAX_DOCUMENT_NESTING`: room for the deepest selection `GRAPHQL_MAX_DEPTH` allows (50) around the deepest
 *   value an argument may hold.
 * - Before execution, every argument of every field of the operation, coerced as the resolvers will receive it
 *   (literals and variables together), may nest at most as deep as a REST body's `data` (`MAX_BODY_DEPTH - 1`).
 *
 * A document too deep is answered like a selection too deep (400 `QUERY_TOO_DEEP`); an argument too deep like
 * a body or variables nested too deep (422 `BODY_TOO_DEEP`).
 */
export const MAX_DOCUMENT_NESTING = 2 * MAX_BODY_DEPTH;
export const MAX_ARGUMENT_DEPTH = MAX_BODY_DEPTH - 1;

const tooDeep = (message: string, limit: number) => new AppError(422, 'BODY_TOO_DEEP', message, { limit });

const OPENING = new Set(['{', '[', '(']);
const CLOSING = new Set(['}', ']', ')']);

/** Where the string or comment starting at `index` ends (the index after it). */
const skipLiteral = (source: string, index: number): number => {
  if (source[index] === '#') {
    const end = source.indexOf('\n', index);
    return end === -1 ? source.length : end;
  }
  if (source.startsWith('"""', index)) {
    let at = index + 3;
    for (;;) {
      const end = source.indexOf('"""', at);
      if (end === -1) {
        return source.length;
      }
      // `\"""` is an escaped quote run inside a block string.
      if (source[end - 1] !== '\\') {
        return end + 3;
      }
      at = end + 3;
    }
  }
  let at = index + 1;
  while (at < source.length && source[at] !== '"' && source[at] !== '\n') {
    at += source[at] === '\\' ? 2 : 1;
  }
  return at + 1;
};

/** Whether the document's brackets nest deeper than `limit`, outside strings and comments (no parsing). */
export const documentNestsDeeperThan = (source: string, limit: number): boolean => {
  let depth = 0;
  let index = 0;
  while (index < source.length) {
    const char = source[index] as string;
    if (char === '"' || char === '#') {
      index = skipLiteral(source, index);
      continue;
    }
    if (OPENING.has(char)) {
      depth += 1;
      if (depth > limit) {
        return true;
      }
    } else if (CLOSING.has(char)) {
      depth -= 1;
    }
    index += 1;
  }
  return false;
};

/**
 * The error for a document nested deeper than `MAX_DOCUMENT_NESTING`, found before it is parsed: answered like
 * a selection deeper than `GRAPHQL_MAX_DEPTH` (a validation error, 400 `QUERY_TOO_DEEP`); undefined when it fits.
 */
export const documentNestingError = (source: string): GraphQLError | undefined =>
  documentNestsDeeperThan(source, MAX_DOCUMENT_NESTING)
    ? new GraphQLError(`The query nests more than ${MAX_DOCUMENT_NESTING} levels deep`, {
        extensions: { code: 'QUERY_TOO_DEEP', limit: MAX_DOCUMENT_NESTING },
      })
    : undefined;

/**
 * Refuses an operation one of whose field arguments, coerced with the request's variables, nests deeper than
 * `MAX_ARGUMENT_DEPTH`. Values that do not coerce are left to execution, which answers them as always.
 */
export const assertArgumentDepth = (
  schema: GraphQLSchema,
  document: DocumentNode,
  operation: OperationDefinitionNode,
  variables: Record<string, unknown> | undefined,
): void => {
  const coerced = getVariableValues(schema, operation.variableDefinitions ?? [], variables ?? {});
  if (coerced.errors) {
    return;
  }
  const typeInfo = new TypeInfo(schema);
  let deep = false;
  const visitor = visitWithTypeInfo(typeInfo, {
    Field(node) {
      const field = typeInfo.getFieldDef();
      if (!field || !node.arguments?.length) {
        return undefined;
      }
      let values: Record<string, unknown>;
      try {
        values = getArgumentValues(field, node, coerced.coerced);
      } catch {
        return undefined;
      }
      if (Object.values(values).some((value) => nestsDeeperThan(value, MAX_ARGUMENT_DEPTH))) {
        deep = true;
        return BREAK;
      }
      return undefined;
    },
  });
  // The operation and the fragments it may spread (a fragment's arguments read the same variables).
  for (const node of [
    operation,
    ...document.definitions.filter((d) => d.kind === Kind.FRAGMENT_DEFINITION),
  ]) {
    visit(node, visitor);
    if (deep) {
      throw tooDeep(
        `A GraphQL argument nests more than ${MAX_ARGUMENT_DEPTH} levels deep`,
        MAX_ARGUMENT_DEPTH,
      );
    }
  }
};
