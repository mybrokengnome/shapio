import { Type, type Static } from 'typebox';
import {
  EmailSchema,
  OneTimeTokenSchema,
  PasswordSchema,
  PersonNameSchema,
  SessionStartedSchema,
} from '../../schemas/adminIdentity.js';
import { ErrorResponseSchema } from '../../schemas/error.js';

export const getSetupStatusSchema = {
  response: {
    200: Type.Object({
      /** No admin exists yet. */
      required: Type.Boolean(),
      /** SETUP_REQUIRE_TOKEN: setup also needs the one-time token from the server log. */
      requiresToken: Type.Boolean(),
    }),
  },
};

export const CompleteSetupBodySchema = Type.Object(
  {
    token: Type.Optional(OneTimeTokenSchema),
    email: EmailSchema,
    name: PersonNameSchema,
    password: PasswordSchema,
    /**
     * Renames the built-in workspace (key `default`, which stays). Same rules as a workspace's name in
     * routes/admin/sites/schemas.ts. Absent: the name is left as it is.
     */
    workspaceName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  },
  { additionalProperties: false },
);
export type CompleteSetupBody = Static<typeof CompleteSetupBodySchema>;

export const completeSetupSchema = {
  body: CompleteSetupBodySchema,
  response: { 201: SessionStartedSchema, 403: ErrorResponseSchema, 409: ErrorResponseSchema },
};
