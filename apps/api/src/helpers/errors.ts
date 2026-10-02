const MAX_ERROR_LENGTH = 4000;

/** A bounded, single-string description of an unknown thrown value, safe to store in a text column. */
export const describeError = (error: unknown): string => {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.length > MAX_ERROR_LENGTH ? `${text.slice(0, MAX_ERROR_LENGTH)}…` : text;
};
