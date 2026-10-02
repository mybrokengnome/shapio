import type { AuditActorType } from '@shapio/client';

export const AUDIT_ACTOR_TYPES = [
  'admin',
  'app_user',
  'token',
  'anonymous',
  'system',
] as const satisfies readonly AuditActorType[];
