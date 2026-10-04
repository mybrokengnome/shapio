import { Type } from 'typebox';
import { EDITOR_FILE_PATTERN } from '../../../extensions/editorManifest.js';

const closed = { additionalProperties: false } as const;

export const listEditorsSchema = {
  response: {
    200: Type.Object({
      items: Type.Array(Type.Object({ file: Type.String(), path: Type.String(), hash: Type.String() })),
    }),
  },
};

export const getEditorFileSchema = {
  params: Type.Object({ file: Type.String({ pattern: EDITOR_FILE_PATTERN.source, maxLength: 200 }) }, closed),
  querystring: Type.Object({ v: Type.Optional(Type.String({ maxLength: 64 })) }, closed),
};

export const listThemesSchema = {
  response: {
    200: Type.Object({
      items: Type.Array(
        Type.Object({
          key: Type.String(),
          name: Type.String(),
          description: Type.Optional(Type.String()),
          variants: Type.Array(Type.Union([Type.Literal('light'), Type.Literal('dark')])),
        }),
      ),
    }),
  },
};
