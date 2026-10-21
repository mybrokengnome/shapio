import { Type } from 'typebox';
import { LocaleCodeSchema } from '../../schemas/content.js';
import { StableIdSchema } from '../../schemas/schemaRegistry.js';

const closed = { additionalProperties: false } as const;

/** A comma-separated list in one query parameter (`types=post,about`, `ids=<id>,<id>`). */
const CommaList = Type.String({ minLength: 1, maxLength: 4000 });

export const listContentTargetsSchema = {
  querystring: Type.Object(
    {
      /** The relation field's stable ID (top level or inside a component). */
      field: StableIdSchema,
      /** Narrow to these models, by singular API ID. Ignored with `ids`. */
      types: Type.Optional(CommaList),
      q: Type.Optional(Type.String({ maxLength: 200 })),
      page: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000_000 })),
      pageSize: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      locale: Type.Optional(LocaleCodeSchema),
      /** Exactly these entries (at most 100); `q`, `types` and paging are ignored. */
      ids: Type.Optional(CommaList),
    },
    closed,
  ),
  response: {
    200: Type.Object(
      {
        target: Type.Object(
          {
            kind: Type.Enum(['model', 'interface', 'any']),
            label: Type.Union([Type.String(), Type.Null()]),
          },
          closed,
        ),
        members: Type.Array(Type.Object({ apiKey: Type.String(), label: Type.String() }, closed)),
        items: Type.Array(
          Type.Object(
            {
              id: Type.String(),
              model: Type.String(),
              title: Type.Union([Type.String(), Type.Null()]),
              status: Type.Enum(['draft', 'published', 'modified']),
              locale: Type.String(),
              updatedAt: Type.String(),
            },
            closed,
          ),
        ),
        total: Type.Integer(),
      },
      closed,
    ),
  },
};
