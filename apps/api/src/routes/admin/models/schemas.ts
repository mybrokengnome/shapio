import { Type } from 'typebox';
import {
  AcknowledgementSchema,
  ActiveDefinitionSchema,
  ChangeJobSchema,
  DefinitionScopeSchema,
  ChangeOutcomeSchema,
  ChangePlanSchema,
  definitionInputFor,
  IdParamsSchema,
  ImpactSchema,
  RevisionSummarySchema,
  StableIdSchema,
} from '../../schemas/schemaRegistry.js';

const closed = { additionalProperties: false } as const;
const ExpectedVersion = Type.Integer({ minimum: 1 });

/** Route schemas for one definition category (models: collections + singletons; components). */
export const definitionRouteSchemas = (category: 'model' | 'component') => {
  const definition = definitionInputFor(category);
  const outcome = { 200: ChangeOutcomeSchema, 201: ChangeOutcomeSchema, 202: ChangeOutcomeSchema };
  const preview = { 200: Type.Object({ plan: ChangePlanSchema, impact: ImpactSchema }) };
  /** Where a create lands: the request's site (default) or every site (`network`). */
  const scope = { scope: Type.Optional(DefinitionScopeSchema) };
  return {
    list: {
      querystring: Type.Object(scope, closed),
      response: {
        200: Type.Object({
          items: Type.Array(
            Type.Intersect([
              ActiveDefinitionSchema,
              Type.Object({
                /** The change still running its prerequisites, if any (the Models list shows it). */
                pendingChange: Type.Union([
                  Type.Object({ id: Type.String(), status: Type.String() }),
                  Type.Null(),
                ]),
              }),
            ]),
          ),
        }),
      },
    },
    get: {
      params: IdParamsSchema,
      response: {
        200: Type.Intersect([
          ActiveDefinitionSchema,
          Type.Object({ pendingChange: Type.Union([ChangeJobSchema, Type.Null()]) }),
        ]),
      },
    },
    create: {
      body: Type.Object({ definition, ...scope, ...AcknowledgementSchema }, closed),
      response: outcome,
    },
    planCreate: { body: Type.Object({ definition, ...scope }, closed), response: preview },
    update: {
      params: IdParamsSchema,
      body: Type.Object({ definition, expectedVersion: ExpectedVersion, ...AcknowledgementSchema }, closed),
      response: outcome,
    },
    planUpdate: {
      params: IdParamsSchema,
      body: Type.Object({ definition, expectedVersion: ExpectedVersion }, closed),
      response: preview,
    },
    remove: {
      params: IdParamsSchema,
      querystring: Type.Object({ expectedVersion: ExpectedVersion }, closed),
      response: outcome,
    },
    changeScope: {
      params: IdParamsSchema,
      body: Type.Object(
        {
          scope: DefinitionScopeSchema,
          /** For `site`: the site to keep it on (default: the request's site). */
          siteId: Type.Optional(Type.String({ format: 'uuid' })),
          /** The definition's active version (409 when it moved). */
          version: ExpectedVersion,
        },
        closed,
      ),
      response: {
        200: Type.Object({
          status: Type.Union([Type.Literal('activated'), Type.Literal('unchanged')]),
          definitionId: Type.String(),
          scope: DefinitionScopeSchema,
          siteId: Type.Union([Type.String(), Type.Null()]),
          version: Type.Integer(),
          schemaVersion: Type.Integer(),
        }),
      },
    },
    listRevisions: {
      params: IdParamsSchema,
      response: { 200: Type.Object({ items: Type.Array(RevisionSummarySchema) }) },
    },
    getRevision: {
      params: Type.Object({ id: StableIdSchema, revisionId: StableIdSchema }),
      response: { 200: Type.Intersect([RevisionSummarySchema, Type.Object({ definition: Type.Unknown() })]) },
    },
    listChanges: {
      params: IdParamsSchema,
      response: { 200: Type.Object({ items: Type.Array(ChangeJobSchema) }) },
    },
  };
};
