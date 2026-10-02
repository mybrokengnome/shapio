import { Type } from 'typebox';
import { UuidSchema } from '../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../schemas/error.js';

const errors = {
  400: ErrorResponseSchema,
  403: ErrorResponseSchema,
  404: ErrorResponseSchema,
  416: ErrorResponseSchema,
};

/** The bytes of a stored object; 200/206 bodies are streams, so only errors have a JSON schema. */
export const getMediaFileSchema = {
  params: Type.Object({ '*': Type.String({ minLength: 1, maxLength: 1024 }) }),
  querystring: Type.Object(
    {
      expires: Type.Optional(Type.Integer({ minimum: 0 })),
      signature: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
    },
    { additionalProperties: false },
  ),
  response: errors,
};

/** Local-driver upload of one grant's bytes (multipart: Content-Type, expires, signature, then file). */
export const receiveUploadSchema = {
  params: Type.Object({ grantId: UuidSchema }),
  response: {
    204: Type.Null(),
    400: ErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    413: ErrorResponseSchema,
  },
};
