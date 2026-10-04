import { Type, type Static } from 'typebox';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../constants/auth.js';
import {
  CONTENT_ACTIONS,
  GLOBAL_ACTIONS,
  NETWORK_ACTIONS,
  SITE_ACTIONS,
  SITE_GRANTABLE_ACTION_LIST,
} from '../../permissions/types.js';

/** Schemas shared by the admin identity routes (setup, auth, users, roles, tokens). */

/** A timestamp in a response: a Date in handlers, ISO-8601 on the wire (fast-json-stringify formats it). */
export const DateTimeSchema = Type.Unsafe<Date>({ type: 'string', format: 'date-time' });
export const NullableDateTimeSchema = Type.Union([DateTimeSchema, Type.Null()]);
/** A timestamp in a request: an ISO-8601 string. */
export const DateTimeInputSchema = Type.String({ format: 'date-time' });
export const UuidSchema = Type.String({ format: 'uuid' });

export const IdParamsSchema = Type.Object({ id: UuidSchema });
export type IdParams = Static<typeof IdParamsSchema>;

export const EmailSchema = Type.String({ format: 'email', minLength: 3, maxLength: 254 });
export const PasswordSchema = Type.String({ minLength: PASSWORD_MIN_LENGTH, maxLength: PASSWORD_MAX_LENGTH });
/** A password being checked (login, current password): any length policy applies only to new ones. */
export const PasswordAttemptSchema = Type.String({ minLength: 1, maxLength: PASSWORD_MAX_LENGTH });
export const PersonNameSchema = Type.String({ minLength: 1, maxLength: 200 });
/** Single-use tokens from links and logs: 43 base64url characters. */
export const OneTimeTokenSchema = Type.String({ minLength: 16, maxLength: 128, pattern: '^[A-Za-z0-9_-]+$' });

/** A role held on one site, or on every site (`siteId` null). */
export const RoleAssignmentSchema = Type.Object(
  { roleId: UuidSchema, siteId: Type.Union([UuidSchema, Type.Null()]) },
  { additionalProperties: false },
);

export const AdminUserSchema = Type.Object({
  id: UuidSchema,
  email: Type.String(),
  name: Type.String(),
  status: Type.Union([Type.Literal('active'), Type.Literal('disabled')]),
  /** Where each role applies. */
  assignments: Type.Array(RoleAssignmentSchema),
  /** Deprecated: the distinct roles of `assignments`, on any site. */
  roleIds: Type.Array(UuidSchema),
  lastLoginAt: NullableDateTimeSchema,
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});

/** Returned whenever a session starts: the user, and the CSRF token for its mutations. */
export const SessionStartedSchema = Type.Object({ user: AdminUserSchema, csrfToken: Type.String() });

export const ContentActionSchema = Type.Enum(CONTENT_ACTIONS);
export const GlobalActionSchema = Type.Enum(GLOBAL_ACTIONS);
export const NetworkActionSchema = Type.Enum(NETWORK_ACTIONS);
export const SiteActionSchema = Type.Enum(SITE_ACTIONS);
/** What `me.sitePermissions` lists: site actions, and network actions a role on the site grants there. */
export const SitePermissionSchema = Type.Enum([...SITE_ACTIONS, ...SITE_GRANTABLE_ACTION_LIST]);

export const PermissionSchema = Type.Object(
  {
    action: Type.Enum([...CONTENT_ACTIONS, ...GLOBAL_ACTIONS]),
    modelId: Type.Union([Type.String({ minLength: 1, maxLength: 100 }), Type.Null()]),
    condition: Type.Union([Type.Literal('ownedByPrincipal'), Type.Null()]),
    fieldIds: Type.Union([
      Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 500 }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);
