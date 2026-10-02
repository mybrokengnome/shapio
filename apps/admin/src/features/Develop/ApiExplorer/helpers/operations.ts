import type { OpenApiDocument, OpenApiParameter } from '@/api/apiDocs';

/**
 * Delivery endpoints from the live OpenAPI document (`/api/docs/openapi.json`, generated from the
 * registry): every `GET /api/content/…` operation, grouped by the model (OpenAPI tag) it belongs to.
 */
export const DELIVERY_PREFIX = '/api/content/';

export type DeliveryOperation = {
  id: string;
  path: string;
  summary: string;
  tag: string;
  /** The model's route key (`articles`): the first path segment after `/api/content/`. */
  routeKey: string;
  /** Reads one entry by ID (`/{id}` in the path). */
  byId: boolean;
  /** Has list parameters (filters, sort, pages). */
  list: boolean;
  parameters: OpenApiParameter[];
};

export type OperationGroup = { tag: string; operations: DeliveryOperation[] };

export const deliveryOperations = (document: OpenApiDocument): DeliveryOperation[] =>
  Object.entries(document.paths).flatMap(([path, methods]) => {
    const operation = methods.get;
    if (!path.startsWith(DELIVERY_PREFIX) || !operation?.operationId) {
      return [];
    }
    const parameters = operation.parameters ?? [];
    return [
      {
        id: operation.operationId,
        path,
        summary: operation.summary ?? path,
        tag: operation.tags?.[0] ?? '',
        routeKey: path.slice(DELIVERY_PREFIX.length).split('/')[0] ?? '',
        byId: path.includes('{id}'),
        list: parameters.some((parameter) => parameter.name === 'filters'),
        parameters,
      },
    ];
  });

/** Operations by tag, in the document's tag order (models by label). */
export const groupOperations = (
  document: OpenApiDocument,
  operations: readonly DeliveryOperation[],
): OperationGroup[] => {
  const order = (document.tags ?? []).map((tag) => tag.name);
  const tags = [...new Set([...order, ...operations.map((operation) => operation.tag)])];
  return tags
    .map((tag) => ({ tag, operations: operations.filter((operation) => operation.tag === tag) }))
    .filter((group) => group.operations.length > 0);
};

export const hasParameter = (operation: DeliveryOperation, name: string) =>
  operation.parameters.some((parameter) => parameter.name === name);
