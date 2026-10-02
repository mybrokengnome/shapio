/** The DOM id of a field's control: unique per form (`prefix`) and value path (`/hero/title`). */
export const fieldDomId = (prefix: string, path: string) =>
  `${prefix}field${path.replace(/[^A-Za-z0-9_-]/g, '-')}`;
