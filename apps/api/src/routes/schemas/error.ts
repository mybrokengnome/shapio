import { Type, type Static } from 'typebox';

/** The one error shape every endpoint returns (central error handler). */
export const ErrorResponseSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

export type ErrorResponse = Static<typeof ErrorResponseSchema>;
