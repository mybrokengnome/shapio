/**
 * Text an editor could not turn into a value ("3.7" in an integer field, half-typed JSON). The editor puts
 * it in the form in place of the value, so the form counts the field as changed, the text survives the
 * editor unmounting (settings drawer closed, items reordered), and nothing is sent until it parses: Save,
 * Create and Publish refuse, and autosave holds the field back.
 */
export class UnparsedText {
  readonly text: string;

  constructor(text: string) {
    this.text = text;
    Object.freeze(this);
  }
}

export const unparsedText = (text: string) => new UnparsedText(text);

export const isUnparsed = (value: unknown): value is UnparsedText => value instanceof UnparsedText;

const segment = (key: string | number) => String(key).replace(/~/g, '~0').replace(/\//g, '~1');

const collect = (value: unknown, path: string, found: string[]) => {
  if (isUnparsed(value)) {
    found.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => collect(item, `${path}/${segment(index)}`, found));
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      collect(child, `${path}/${segment(key)}`, found);
    }
  }
};

/** JSON pointers of every value (at any depth, component items included) still holding unparsed text. */
export const unparsedPathsOf = (values: Readonly<Record<string, unknown>>): string[] => {
  const found: string[] = [];
  collect(values, '', found);
  return found;
};

/** Whether a value holds unparsed text anywhere inside it. */
export const containsUnparsed = (value: unknown): boolean => {
  const found: string[] = [];
  collect(value, '', found);
  return found.length > 0;
};

/** A deep copy (list item duplication) that keeps unparsed text: it is immutable, so it is shared. */
export const cloneValue = <T>(value: T): T => {
  if (isUnparsed(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(cloneValue) as T;
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)])) as T;
  }
  return value;
};
