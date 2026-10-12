import {
  execute,
  getOperationAST,
  GraphQLError,
  Kind,
  parse,
  validate,
  type DocumentNode,
  type ExecutionResult,
  type GraphQLSchema,
  type OperationDefinitionNode,
  type ValidationRule,
} from 'graphql';
import { fragmentsOf, selectsIntrospection } from '../schema/codegen/graphql/complexity.js';
import type { GraphqlRequestContext } from '../schema/codegen/graphql/context.js';
import type { DocumentCache, PreparedDocument } from '../schema/codegen/graphql/documentCache.js';

/** One GraphQL request as received over HTTP (GraphQL-over-HTTP: query, variables, operation name). */
export type GraphqlOperationInput = {
  query: string;
  variables?: Record<string, unknown> | null;
  operationName?: string | null;
};

export type PreparedOperation =
  | (PreparedDocument & { ok: true; operation: OperationDefinitionNode })
  | {
      ok: false;
      errors: readonly GraphQLError[];
      /** The parsed document when it parsed but failed validation (or named no operation); absent on a syntax error. */
      document?: DocumentNode;
    };

type PrepareDependencies = { documents: DocumentCache; rules: readonly ValidationRule[] };

const operationsOf = (document: DocumentNode) =>
  document.definitions.filter(
    (definition): definition is OperationDefinitionNode => definition.kind === Kind.OPERATION_DEFINITION,
  );

/** Whether any operation of the document reads `__schema` or `__type` (gated per caller). */
const documentSelectsIntrospection = (document: DocumentNode) => {
  const fragments = fragmentsOf(document.definitions);
  return operationsOf(document).some((operation) => selectsIntrospection(operation.selectionSet, fragments));
};

/** Parses and validates (cached per schema and source text), then picks the operation to execute. */
const prepareDocument = (
  schema: GraphQLSchema,
  source: string,
  { documents, rules }: PrepareDependencies,
): PreparedDocument | { errors: readonly GraphQLError[]; document?: DocumentNode } => {
  const cached = documents.get(schema, source);
  if (cached) {
    return cached;
  }
  let document: DocumentNode;
  try {
    document = parse(source);
  } catch (error) {
    if (error instanceof GraphQLError) {
      return { errors: [error] };
    }
    throw error;
  }
  const errors = validate(schema, document, rules);
  if (errors.length > 0) {
    return { errors, document };
  }
  const prepared = { document, selectsIntrospection: documentSelectsIntrospection(document) };
  documents.set(schema, source, prepared);
  return prepared;
};

export const prepareOperation = (
  schema: GraphQLSchema,
  input: GraphqlOperationInput,
  dependencies: PrepareDependencies,
): PreparedOperation => {
  const prepared = prepareDocument(schema, input.query, dependencies);
  if ('errors' in prepared) {
    return { ok: false, ...prepared };
  }
  const operation = getOperationAST(prepared.document, input.operationName ?? undefined);
  if (!operation) {
    const message = input.operationName
      ? `Unknown operation named "${input.operationName}".`
      : 'Must provide operation name if query contains multiple operations.';
    return { ok: false, errors: [new GraphQLError(message)], document: prepared.document };
  }
  return { ok: true, ...prepared, operation };
};

export const executeOperation = async (
  schema: GraphQLSchema,
  prepared: PreparedDocument & { operation: OperationDefinitionNode },
  input: GraphqlOperationInput,
  context: GraphqlRequestContext,
): Promise<ExecutionResult> =>
  execute({
    schema,
    document: prepared.document,
    operationName: prepared.operation.name?.value,
    variableValues: input.variables ?? undefined,
    contextValue: context,
  });
