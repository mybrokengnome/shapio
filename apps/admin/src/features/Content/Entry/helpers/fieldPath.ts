import type { ComponentDefinition, FieldDefinition, ModelDefinition } from '@shapio/schema';
import { isRecord, toList } from '@/fields/helpers/values';

export type PathTarget = {
  /** The entry's own field the path starts in (what the document can reveal). */
  topLevel: FieldDefinition;
  /** Readable trail: field labels, with list positions ("Sections › 3 › Title"). */
  trail: string[];
  /** The deepest field the path reached. */
  field: FieldDefinition;
};

const decode = (segment: string) => segment.replace(/~1/g, '/').replace(/~0/g, '~');

/**
 * Where a JSON pointer (API keys, `/sections/2/title`) points in the document: the top-level field to
 * reveal and a readable trail of labels for sentences. Unknown segments end the trail.
 */
export const resolveFieldPath = (
  model: ModelDefinition,
  components: ReadonlyMap<string, ComponentDefinition>,
  values: Readonly<Record<string, unknown>>,
  path: string,
): PathTarget | undefined => {
  const segments = path.split('/').slice(1).map(decode);
  const topLevel = model.fields.find((field) => field.apiKey === segments[0]);
  if (!topLevel) {
    return undefined;
  }
  const trail = [topLevel.label];
  let field: FieldDefinition = topLevel;
  let value: unknown = values[topLevel.apiKey];
  for (const segment of segments.slice(1)) {
    if (/^\d+$/.test(segment)) {
      trail.push(String(Number(segment) + 1));
      value = toList(value)[Number(segment)];
      continue;
    }
    const zoneKey = isRecord(value) ? value.__component : undefined;
    const owner: ComponentDefinition | undefined =
      field.type === 'component'
        ? components.get(field.settings.component)
        : field.type === 'dynamiczone'
          ? [...components.values()].find((component) => component.apiKey === zoneKey)
          : undefined;
    const next = owner?.fields.find((candidate) => candidate.apiKey === segment);
    if (!next) {
      break;
    }
    trail.push(next.label);
    field = next;
    value = isRecord(value) ? value[segment] : undefined;
  }
  return { topLevel, trail, field };
};
