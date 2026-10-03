import type { ComponentDefinition, FieldDefinition, RichTextNode } from '@shapio/schema';
import type { ContentModel } from '../../content/model.js';
import { COMPONENT_KEY } from '../../content/validator/index.js';
import { pointer } from '../../content/validator/issues.js';
import type { ContentData } from '../../db/contentData.js';

/**
 * The translate walker (plan §I): finds every translatable text leaf of a stored document and rebuilds the
 * document with the translations. Leaves are `string` and `text` values, rich-text text blocks (paragraphs
 * and headings, with marked spans encoded as `<mN>…</mN>` and hard breaks as `<bN/>` so formatting survives
 * the round trip) and image `alt`/`title` attributes, inside components and dynamic-zone items too.
 * Everything else (numbers, slugs, enums, URLs, media and relation IDs, code blocks) is copied as is.
 *
 * Pure: `collectTextLeaves` and `applyTranslations` walk in the same order, so the n-th leaf of one is the
 * n-th leaf of the other.
 */

export type TextLeaf = {
  /** JSON pointer in API keys of the field the leaf belongs to (issues are reported there). */
  path: string;
  /** Plain text, or a rich-text block with inline tags. */
  text: string;
  kind: 'plain' | 'block';
  maxLength?: number;
};

export type WalkIssue = { path: string; code: 'FORMATTING_LOST'; message: string };

type Visit = (leaf: TextLeaf) => string;

type WalkState = { model: ContentModel; visit: Visit; issues: WalkIssue[] };

const TRANSLATABLE_SCALARS: ReadonlySet<string> = new Set(['string', 'text']);
const TEXT_BLOCKS: ReadonlySet<string> = new Set(['paragraph', 'heading']);
const TAG_PATTERN = /<m(\d+)>|<\/m(\d+)>|<b(\d+)\/>/g;
const MAX_IMAGE_TEXT = 1000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasText = (value: string) => value.trim() !== '';

/** A text block's inline children as one string with tags, and what each tag stands for. */
const encodeBlock = (children: readonly RichTextNode[]) => {
  const tagged = new Map<number, RichTextNode>();
  let text = '';
  children.forEach((child, index) => {
    if (child.type === 'hardBreak') {
      tagged.set(index, child);
      text += `<b${index}/>`;
    } else if (child.type === 'text' && child.marks?.length) {
      tagged.set(index, child);
      text += `<m${index}>${child.text ?? ''}</m${index}>`;
    } else if (child.type === 'text') {
      text += child.text ?? '';
    }
  });
  return { text, tagged };
};

/** Rebuilds inline children from translated tagged text; undefined when the tags do not match. */
const decodeBlock = (text: string, tagged: ReadonlyMap<number, RichTextNode>): RichTextNode[] | undefined => {
  const output: RichTextNode[] = [];
  const used = new Set<number>();
  let open: { index: number; start: number } | undefined;
  let cursor = 0;
  const plain = (value: string) => {
    if (value !== '') {
      output.push({ type: 'text', text: value });
    }
  };
  for (const match of text.matchAll(TAG_PATTERN)) {
    const at = match.index;
    const [, opening, closing, lineBreak] = match;
    if (opening !== undefined) {
      const index = Number(opening);
      if (open || !tagged.has(index) || tagged.get(index)?.type !== 'text' || used.has(index)) {
        return undefined;
      }
      plain(text.slice(cursor, at));
      open = { index, start: at + match[0].length };
    } else if (closing !== undefined) {
      const index = Number(closing);
      if (!open || open.index !== index) {
        return undefined;
      }
      const inner = text.slice(open.start, at);
      const original = tagged.get(index);
      if (inner !== '' && original) {
        output.push({ ...original, text: inner });
      }
      used.add(index);
      open = undefined;
    } else if (lineBreak !== undefined) {
      const index = Number(lineBreak);
      if (open || tagged.get(index)?.type !== 'hardBreak' || used.has(index)) {
        return undefined;
      }
      plain(text.slice(cursor, at));
      output.push({ type: 'hardBreak' });
      used.add(index);
    }
    cursor = at + match[0].length;
  }
  if (open || used.size !== tagged.size) {
    return undefined;
  }
  plain(text.slice(cursor));
  return output;
};

const stripTags = (text: string) => text.replace(TAG_PATTERN, (tag) => (tag.startsWith('<b') ? '\n' : ''));

const walkTextBlock = (node: RichTextNode, path: string, state: WalkState): RichTextNode => {
  const children = node.content ?? [];
  const { text, tagged } = encodeBlock(children);
  if (!hasText(stripTags(text))) {
    return node;
  }
  const translated = state.visit({ path, text, kind: 'block' });
  if (translated === text) {
    return node;
  }
  const decoded = decodeBlock(translated, tagged);
  if (decoded) {
    return { ...node, content: decoded };
  }
  state.issues.push({
    path,
    code: 'FORMATTING_LOST',
    message: 'The translation lost the inline formatting of a paragraph; it is kept as plain text',
  });
  const lines = stripTags(translated).split('\n');
  const content = lines.flatMap((line, index): RichTextNode[] => [
    ...(index > 0 ? [{ type: 'hardBreak' }] : []),
    ...(line !== '' ? [{ type: 'text', text: line }] : []),
  ]);
  return { ...node, content };
};

const walkImage = (node: RichTextNode, path: string, state: WalkState): RichTextNode => {
  const attrs = { ...(node.attrs ?? {}) };
  for (const name of ['alt', 'title'] as const) {
    const value = attrs[name];
    if (typeof value === 'string' && hasText(value)) {
      attrs[name] = state.visit({ path, text: value, kind: 'plain', maxLength: MAX_IMAGE_TEXT });
    }
  }
  return { ...node, attrs };
};

const walkRichNode = (node: RichTextNode, path: string, state: WalkState): RichTextNode => {
  if (TEXT_BLOCKS.has(node.type)) {
    return walkTextBlock(node, path, state);
  }
  if (node.type === 'image') {
    return walkImage(node, path, state);
  }
  // Code blocks keep their code; containers recurse.
  if (node.type === 'codeBlock' || !node.content) {
    return node;
  }
  return { ...node, content: node.content.map((child) => walkRichNode(child, path, state)) };
};

const componentById = (model: ContentModel, id: unknown): ComponentDefinition | undefined =>
  typeof id === 'string' ? model.components.get(id)?.definition : undefined;

const walkComponentValue = (
  component: ComponentDefinition | undefined,
  value: unknown,
  path: string,
  state: WalkState,
): unknown =>
  component && isRecord(value)
    ? walkFields(
        component.fields.filter((field) => !field.deprecated),
        value,
        path,
        state,
      )
    : value;

const walkValue = (field: FieldDefinition, value: unknown, path: string, state: WalkState): unknown => {
  if (value === undefined || value === null) {
    return value;
  }
  if (TRANSLATABLE_SCALARS.has(field.type)) {
    const maxLength = (field.settings as { maxLength?: number }).maxLength;
    return typeof value === 'string' && hasText(value)
      ? state.visit({ path, text: value, kind: 'plain', ...(maxLength ? { maxLength } : {}) })
      : value;
  }
  switch (field.type) {
    case 'richtext':
      return isRecord(value) && isRecord(value.doc)
        ? { ...value, doc: walkRichNode(value.doc as RichTextNode, path, state) }
        : value;
    case 'component': {
      const component = state.model.components.get(field.settings.component)?.definition;
      return field.settings.repeatable && Array.isArray(value)
        ? value.map((item, index) => walkComponentValue(component, item, pointer(path, index), state))
        : walkComponentValue(component, value, path, state);
    }
    case 'dynamiczone':
      return Array.isArray(value)
        ? value.map((item, index) => {
            const component = isRecord(item) ? componentById(state.model, item[COMPONENT_KEY]) : undefined;
            return walkComponentValue(component, item, pointer(path, index), state);
          })
        : value;
    default:
      return value;
  }
};

function walkFields(
  fields: readonly FieldDefinition[],
  data: Readonly<Record<string, unknown>>,
  base: string,
  state: WalkState,
): Record<string, unknown> {
  const output: Record<string, unknown> = { ...data };
  for (const field of fields) {
    if (data[field.id] !== undefined) {
      output[field.id] = walkValue(field, data[field.id], pointer(base, field.apiKey), state);
    }
  }
  return output;
}

/** Every translatable leaf of `fields` in a stored document, in walk order. */
export const collectTextLeaves = (
  model: ContentModel,
  fields: readonly FieldDefinition[],
  data: Readonly<ContentData>,
): TextLeaf[] => {
  const leaves: TextLeaf[] = [];
  walkFields(fields, data, '', {
    model,
    issues: [],
    visit: (leaf) => {
      leaves.push(leaf);
      return leaf.text;
    },
  });
  return leaves;
};

/**
 * The stored document with the n-th leaf replaced by `translations[n]`, limited to `fields`, and the leaves
 * whose formatting could not be restored.
 */
export const applyTranslations = (
  model: ContentModel,
  fields: readonly FieldDefinition[],
  data: Readonly<ContentData>,
  translations: readonly string[],
): { data: ContentData; issues: WalkIssue[] } => {
  let next = 0;
  const state: WalkState = {
    model,
    issues: [],
    visit: (leaf) => translations[next++] ?? leaf.text,
  };
  const walked = walkFields(fields, data, '', state);
  const translated: ContentData = {};
  for (const field of fields) {
    if (walked[field.id] !== undefined) {
      translated[field.id] = walked[field.id];
    }
  }
  return { data: translated, issues: state.issues };
};
