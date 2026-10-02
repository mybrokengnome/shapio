/** Joins the ids that describe a control (hint, description, error), or undefined when there are none. */
export const describedBy = (...ids: Array<string | false | null | undefined>): string | undefined =>
  ids.filter(Boolean).join(' ') || undefined;
