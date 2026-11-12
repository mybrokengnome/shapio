import {
  BREAK,
  getArgumentValues,
  getVariableValues,
  GraphQLError,
  Kind,
  Lexer,
  Source,
  TokenKind,
  TypeInfo,
  visit,
  visitWithTypeInfo,
  type DocumentNode,
  type GraphQLSchema,
  type OperationDefinitionNode,
} from 'graphql';
import { MAX_CONTENT_DEPTH } from '../../../constants/requestBody.js';
import { AppError } from '../../../helpers/appError.js';
import { nestsDeeperThan } from '../../../helpers/jsonDepth.js';

/**
 * Bounds on what a GraphQL document may make the server do before it runs, beside the request body's own
 * limits (plugins/textInput.ts): a value written as a literal in the query text is a string in the body, so the
 * body's depth limit never counts it, and graphql-js has no nesting limit of its own (its parser and value
 * coercion recurse, so a document thousands of levels deep would overflow the stack, a 500), and validation
 * grows with the square of repeated fields.
 *
 * - Before parsing, the document is read with graphql-js's own lexer (so comments and strings end exactly where
 *   the parser ends them, `\r` included): more than `maxTokens` tokens is 400 `QUERY_TOO_LARGE`, bracket nesting
 *   (`{`, `[`, `(`) past `MAX_DOCUMENT_NESTING` is 400 `QUERY_TOO_DEEP`, as a selection too deep is.
 * - Before execution, every argument of every field of the operation, coerced as the resolvers will receive it
 *   (literals and variables together), may nest at most as deep as content may (`MAX_CONTENT_DEPTH`): 422
 *   `BODY_TOO_DEEP`, as a body or variables nested too deep.
 */
export const MAX_ARGUMENT_DEPTH = MAX_CONTENT_DEPTH;
/** Room for the deepest selection `GRAPHQL_MAX_DEPTH` allows (50) around the deepest argument value. */
export const MAX_DOCUMENT_NESTING = 2 * MAX_CONTENT_DEPTH;

const tooDeep = (message: string, limit: number) => new AppError(422, 'BODY_TOO_DEEP', message, { limit });

const OPENING: ReadonlySet<TokenKind> = new Set([TokenKind.BRACE_L, TokenKind.BRACKET_L, TokenKind.PAREN_L]);
const CLOSING: ReadonlySet<TokenKind> = new Set([TokenKind.BRACE_R, TokenKind.BRACKET_R, TokenKind.PAREN_R]);

/**
 * The error for a document over `maxTokens` tokens (comments not counted, as graphql-js counts them) or nested
 * deeper than `MAX_DOCUMENT_NESTING`, found in one pass of the lexer before parsing; undefined when it fits. A
 * syntax error stops the pass: parsing reports it.
 */
export const documentSizeError = (source: string, maxTokens: number): GraphQLError | undefined => {
  const lexer = new Lexer(new Source(source));
  let tokens = 0;
  let depth = 0;
  try {
    for (let token = lexer.advance(); token.kind !== TokenKind.EOF; token = lexer.advance()) {
      tokens += 1;
      if (tokens > maxTokens) {
        return new GraphQLError(`The query has more than ${maxTokens} tokens`, {
          extensions: { code: 'QUERY_TOO_LARGE', limit: maxTokens },
        });
      }
      if (OPENING.has(token.kind)) {
        depth += 1;
        if (depth > MAX_DOCUMENT_NESTING) {
          return new GraphQLError(`The query nests more than ${MAX_DOCUMENT_NESTING} levels deep`, {
            extensions: { code: 'QUERY_TOO_DEEP', limit: MAX_DOCUMENT_NESTING },
          });
        }
      } else if (CLOSING.has(token.kind)) {
        depth -= 1;
      }
    }
  } catch (error) {
    if (error instanceof GraphQLError) {
      return undefined;
    }
    throw error;
  }
  return undefined;
};

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
