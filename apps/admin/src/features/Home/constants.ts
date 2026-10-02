/** Audit events in the Recent activity panel. */
export const RECENT_ACTIVITY_LIMIT = 8;

/** Models listed in the Models panel; the rest are one click away. */
export const MODELS_PANEL_LIMIT = 6;

/** Target types whose name is worth a second line in Recent activity (entries, models, people). */
export const NAMED_TARGET_TYPES: ReadonlySet<string> = new Set([
  'entry',
  'model',
  'component',
  'admin_user',
  'app_user',
]);
