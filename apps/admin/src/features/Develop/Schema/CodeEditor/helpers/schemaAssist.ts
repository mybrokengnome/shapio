import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { Tooltip } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import type { JSONSchema7 } from './editorSchema';

/**
 * Completion and hover for schema files, read from the definition's JSON Schema (`editorSchema.ts`): the
 * cursor's place in the document comes from the lezer JSON tree, and the matching sub-schema gives the
 * property names (keys) and the allowed values (enums, consts, booleans). Plain text only, no HTML.
 */
const VALUE_NODES: ReadonlySet<string> = new Set([
  'Object',
  'Array',
  'String',
  'Number',
  'True',
  'False',
  'Null',
]);

const unquote = (text: string) => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const nameOf = (state: EditorState, property: SyntaxNode): string | undefined => {
  const name = property.getChild('PropertyName');
  const value = name ? unquote(state.sliceDoc(name.from, name.to)) : undefined;
  return typeof value === 'string' ? value : undefined;
};

/** The pointer segments from the root to `node` (property names and array indexes). */
const pathOf = (state: EditorState, node: SyntaxNode): string[] => {
  const segments: string[] = [];
  for (let current: SyntaxNode | null = node; current?.parent; current = current.parent) {
    const parent = current.parent;
    if (current.name === 'Property') {
      segments.unshift(nameOf(state, current) ?? '');
    } else if (parent.name === 'Array' && VALUE_NODES.has(current.name)) {
      let index = 0;
      for (let sibling = current.prevSibling; sibling; sibling = sibling.prevSibling) {
        index += VALUE_NODES.has(sibling.name) ? 1 : 0;
      }
      segments.unshift(String(index));
    }
  }
  return segments;
};

/** The `type` value of the object `node` (a field), for the per-type `settings` schema. */
const typeOf = (state: EditorState, object: SyntaxNode | null): unknown => {
  const property = object?.getChildren('Property').find((candidate) => nameOf(state, candidate) === 'type');
  const value = property?.lastChild;
  return value ? unquote(state.sliceDoc(value.from, value.to)) : undefined;
};

const variants = (schema: JSONSchema7): JSONSchema7[] => [
  schema,
  ...(schema.anyOf ?? []),
  ...(schema.oneOf ?? []),
];

/** One step down: an object's property (with `allOf` if/then applied for `object`) or an array's items. */
const child = (schema: JSONSchema7, segment: string, objectType: () => unknown): JSONSchema7 | undefined => {
  for (const candidate of variants(schema)) {
    const conditional = (candidate.allOf ?? []).find(
      (entry) => entry.if?.properties?.type?.const === objectType(),
    );
    const found =
      conditional?.then?.properties?.[segment] ??
      candidate.properties?.[segment] ??
      (Array.isArray(candidate.items) ? candidate.items[Number(segment)] : candidate.items) ??
      Object.values(candidate.patternProperties ?? {})[0];
    if (
      found &&
      (candidate.properties?.[segment] || candidate.items || conditional || candidate.patternProperties)
    ) {
      return found;
    }
  }
  return undefined;
};

/** The sub-schema at `node`'s place; `objects` lists the object nodes along the way (for `type`). */
const schemaAt = (state: EditorState, root: JSONSchema7, node: SyntaxNode): JSONSchema7 | undefined => {
  const path = pathOf(state, node);
  const objects: Array<SyntaxNode | null> = [];
  for (let current: SyntaxNode | null = node; current; current = current.parent) {
    if (current.name === 'Object') {
      objects.unshift(current);
    }
  }
  let schema: JSONSchema7 | undefined = root;
  let depth = 0;
  for (const segment of path) {
    const owner = objects[depth] ?? null;
    schema = schema ? child(schema, segment, () => typeOf(state, owner)) : undefined;
    depth += /^\d+$/.test(segment) ? 0 : 1;
  }
  return schema;
};

const objectProperties = (schema: JSONSchema7) =>
  variants(schema).flatMap((candidate) => [
    ...Object.entries(candidate.properties ?? {}).map(([key, value]) => ({
      key,
      value,
      required: candidate.required?.includes(key) ?? false,
    })),
  ]);

/** Values a schema allows that can be listed: enums, consts, booleans, null. */
const valueOptions = (schema: JSONSchema7): unknown[] =>
  variants(schema).flatMap((candidate) => [
    ...(candidate.enum ?? []),
    ...(candidate.const !== undefined ? [candidate.const] : []),
    ...(candidate.type === 'boolean' ? [true, false] : []),
  ]);

/** A one-line description of a schema's type: `"a" | "b"`, `string`, `object`, `array of object`. */
export const describeType = (schema: JSONSchema7): string => {
  const values = valueOptions(schema);
  if (values.length > 0 && values.length <= 12) {
    return values.map((value) => JSON.stringify(value)).join(' | ');
  }
  const types = variants(schema)
    .map((candidate) => {
      const type = Array.isArray(candidate.type) ? candidate.type.join(' | ') : candidate.type;
      const items = !Array.isArray(candidate.items) ? candidate.items : undefined;
      return type === 'array' && items?.type ? `array of ${String(items.type)}` : type;
    })
    .filter((type): type is string => Boolean(type));
  return [...new Set(types)].join(' | ') || 'any';
};

/** The innermost Object around `pos` and whether `pos` is where a key goes (after `{` or `,`). */
const keyContext = (state: EditorState, node: SyntaxNode, from: number) => {
  const object = node.name === 'Object' ? node : node.name === 'PropertyName' ? node.parent?.parent : null;
  const before = state.sliceDoc(Math.max(0, from - 200), from).trimEnd();
  const atKey = node.name === 'PropertyName' || (object !== null && /[{,]$/.test(before));
  return atKey && object ? object : null;
};

const valueContext = (state: EditorState, node: SyntaxNode): SyntaxNode | null => {
  const property = node.name === 'Property' ? node : node.parent?.name === 'Property' ? node.parent : null;
  if (!property || node.name === 'PropertyName') {
    return null;
  }
  return property;
};

export const schemaCompletion =
  (schema: JSONSchema7) =>
  (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/"?[\w$-]*"?$/);
    const from = word?.from ?? context.pos;
    if (!context.explicit && word?.from === word?.to) {
      return null;
    }
    const tree = syntaxTree(context.state);
    const node = tree.resolveInner(context.pos, -1);
    const object = keyContext(context.state, node, from);
    if (object) {
      const target = schemaAt(context.state, schema, object);
      const present = new Set(
        object.getChildren('Property').map((property) => nameOf(context.state, property)),
      );
      const options: Completion[] = (target ? objectProperties(target) : [])
        .filter(({ key }) => !present.has(key))
        .map(({ key, value, required }) => ({
          label: key,
          apply: `"${key}": `,
          type: 'property',
          detail: describeType(value),
          boost: required ? 1 : 0,
        }));
      return { from, options };
    }
    const property = valueContext(context.state, node);
    const target = property ? schemaAt(context.state, schema, property) : undefined;
    const options = (target ? valueOptions(target) : []).map((value) => ({
      label: JSON.stringify(value),
      type: typeof value === 'string' ? 'enum' : 'keyword',
    }));
    return options.length > 0 ? { from, options } : null;
  };

/** Hover over a property name: its allowed type or values, and its description when the schema has one. */
export const schemaHover =
  (schema: JSONSchema7) =>
  (view: { state: EditorState }, pos: number, side: -1 | 1): Tooltip | null => {
    const node = syntaxTree(view.state).resolveInner(pos, side);
    const property = node.name === 'PropertyName' ? node.parent : null;
    const target = property ? schemaAt(view.state, schema, property) : undefined;
    if (!property || !target) {
      return null;
    }
    return {
      pos: node.from,
      end: node.to,
      above: true,
      create: () => {
        const dom = document.createElement('div');
        const type = document.createElement('code');
        type.textContent = describeType(target);
        dom.append(type);
        if (target.description) {
          const description = document.createElement('p');
          description.textContent = target.description;
          dom.append(description);
        }
        return { dom };
      },
    };
  };
