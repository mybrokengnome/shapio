/** Shortens long text (errors, response bodies) for a table cell; the full text stays in the details. */
export const truncate = (text: string, maxLength: number) =>
  text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
