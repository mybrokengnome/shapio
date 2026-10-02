import { RICHTEXT_FORMAT, RICHTEXT_FORMAT_VERSION } from '@shapio/schema';
import { MARK_RULES, MAX_RICHTEXT_DEPTH, NODE_RULES, type AttrRule } from './spec.js';

/** A ProseMirror JSON node in Shapio's normalized form (only known keys, attributes defaulted). */
export type RichTextNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

export type RichTextDocument = { format: string; version: number; doc: RichTextNode };

export type RichTextProblem = { path: string; message: string };

export type RichTextResult =
  { ok: true; document: RichTextDocument; textLength: number } | { ok: false; problems: RichTextProblem[] };

const NODE_KEYS = new Set(['type', 'attrs', 'content', 'text', 'marks']);
const MAX_PROBLEMS = 20;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type Walk = { problems: RichTextProblem[]; textLength: number };

const fail = (walk: Walk, path: string, message: string): undefined => {
  if (walk.problems.length < MAX_PROBLEMS) {
    walk.problems.push({ path, message });
  }
  return undefined;
};

const checkAttrs = (
  walk: Walk,
  path: string,
  rules: Readonly<Record<string, AttrRule>> | undefined,
  raw: unknown,
): Record<string, unknown> | undefined => {
  if (raw !== undefined && !isRecord(raw)) {
    return fail(walk, `${path}/attrs`, 'must be an object');
  }
  const given = raw ?? {};
  const attrs: Record<string, unknown> = {};
  for (const key of Object.keys(given)) {
    if (!rules || !Object.hasOwn(rules, key)) {
      fail(walk, `${path}/attrs/${key}`, 'is not an allowed attribute');
    }
  }
  for (const [key, rule] of Object.entries(rules ?? {})) {
    const value = Object.hasOwn(given, key) ? given[key] : rule.default;
    if (value === undefined || !rule.check(value)) {
      fail(walk, `${path}/attrs/${key}`, value === undefined ? 'is required' : 'has an invalid value');
      continue;
    }
    attrs[key] = value;
  }
  return Object.keys(attrs).length > 0 ? attrs : undefined;
};

const checkMarks = (walk: Walk, path: string, raw: unknown, allowed: boolean) => {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    return fail(walk, `${path}/marks`, 'must be a list');
  }
  if (!allowed && raw.length > 0) {
    return fail(walk, `${path}/marks`, 'marks are not allowed here');
  }
  const seen = new Set<string>();
  const marks: NonNullable<RichTextNode['marks']> = [];
  raw.forEach((mark: unknown, index) => {
    const at = `${path}/marks/${index}`;
    if (!isRecord(mark) || typeof mark.type !== 'string' || !Object.hasOwn(MARK_RULES, mark.type)) {
      fail(walk, at, 'is not an allowed mark');
      return;
    }
    if (Object.keys(mark).some((key) => key !== 'type' && key !== 'attrs')) {
      fail(walk, at, 'has unknown properties');
    }
    if (seen.has(mark.type)) {
      fail(walk, at, 'is repeated');
    }
    seen.add(mark.type);
    const attrs = checkAttrs(walk, at, MARK_RULES[mark.type]?.attrs, mark.attrs);
    marks.push(attrs ? { type: mark.type, attrs } : { type: mark.type });
  });
  return marks.length > 0 ? marks : undefined;
};

const matchesAllow = (allow: readonly string[], type: string): boolean => {
  const rule = NODE_RULES[type];
  return allow.includes(type) || (rule !== undefined && allow.includes(rule.group));
};

const checkNode = (
  walk: Walk,
  raw: unknown,
  path: string,
  depth: number,
  context: { allow: readonly string[]; marks: boolean },
): RichTextNode | undefined => {
  if (depth > MAX_RICHTEXT_DEPTH) {
    return fail(walk, path, 'is nested too deeply');
  }
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return fail(walk, path, 'must be a node with a type');
  }
  const { type } = raw;
  const rule = Object.hasOwn(NODE_RULES, type) ? NODE_RULES[type] : undefined;
  if (!rule) {
    return fail(walk, path, `"${type}" is not an allowed node`);
  }
  if (!matchesAllow(context.allow, type)) {
    return fail(walk, path, `"${type}" is not allowed here`);
  }
  for (const key of Object.keys(raw)) {
    if (!NODE_KEYS.has(key)) {
      fail(walk, `${path}/${key}`, 'is not an allowed property');
    }
  }
  if (type === 'text') {
    if (typeof raw.text !== 'string' || raw.text.length === 0) {
      return fail(walk, `${path}/text`, 'must be a non-empty string');
    }
    walk.textLength += raw.text.length;
    const marks = checkMarks(walk, path, raw.marks, context.marks);
    return marks ? { type, text: raw.text, marks } : { type, text: raw.text };
  }
  if (raw.text !== undefined) {
    fail(walk, `${path}/text`, 'only text nodes carry text');
  }
  const node: RichTextNode = { type };
  const attrs = checkAttrs(walk, path, rule.attrs, raw.attrs);
  if (attrs) {
    node.attrs = attrs;
  }
  const marks = checkMarks(walk, path, raw.marks, context.marks && rule.group === 'inline');
  if (marks) {
    node.marks = marks;
  }
  if (!rule.content) {
    if (raw.content !== undefined && !(Array.isArray(raw.content) && raw.content.length === 0)) {
      fail(walk, `${path}/content`, `"${type}" has no content`);
    }
    return node;
  }
  if (raw.content !== undefined && !Array.isArray(raw.content)) {
    return fail(walk, `${path}/content`, 'must be a list');
  }
  const children = (raw.content ?? []) as unknown[];
  if (children.length < rule.content.min) {
    fail(walk, `${path}/content`, `"${type}" needs at least ${rule.content.min} child node(s)`);
  }
  const childContext = { allow: rule.content.allow, marks: rule.marks ?? true };
  const content = children.flatMap((child, index) => {
    const checked = checkNode(walk, child, `${path}/content/${index}`, depth + 1, childContext);
    return checked ? [checked] : [];
  });
  if (content.length > 0) {
    node.content = content;
  }
  if (type === 'codeBlock' || type === 'paragraph' || type === 'heading') {
    walk.textLength += 1;
  }
  return node;
};

/**
 * Validates a stored rich-text value: the versioned envelope `{ format, version, doc }` and the document
 * against the baseline schema. Returns a normalized copy (known keys only, attribute defaults filled).
 */
export const validateRichText = (value: unknown): RichTextResult => {
  const walk: Walk = { problems: [], textLength: 0 };
  if (!isRecord(value)) {
    return { ok: false, problems: [{ path: '', message: 'must be a rich-text document object' }] };
  }
  if (value.format !== RICHTEXT_FORMAT) {
    fail(walk, '/format', `must be "${RICHTEXT_FORMAT}"`);
  }
  if (value.version !== RICHTEXT_FORMAT_VERSION) {
    fail(walk, '/version', `must be ${RICHTEXT_FORMAT_VERSION}`);
  }
  for (const key of Object.keys(value)) {
    if (!['format', 'version', 'doc'].includes(key)) {
      fail(walk, `/${key}`, 'is not an allowed property');
    }
  }
  const doc = checkNode(walk, value.doc, '/doc', 0, { allow: ['doc'], marks: false });
  if (walk.problems.length > 0 || !doc) {
    return {
      ok: false,
      problems: walk.problems.length > 0 ? walk.problems : [{ path: '/doc', message: 'is invalid' }],
    };
  }
  return {
    ok: true,
    document: { format: RICHTEXT_FORMAT, version: RICHTEXT_FORMAT_VERSION, doc },
    textLength: walk.textLength,
  };
};

/** True when a document holds no text and no media (an empty editor). */
export const isEmptyRichText = (document: RichTextDocument): boolean => {
  const hasSubstance = (node: RichTextNode): boolean =>
    node.type === 'text' ||
    node.type === 'image' ||
    node.type === 'horizontalRule' ||
    (node.content ?? []).some(hasSubstance);
  return !hasSubstance(document.doc);
};

/** Media assets a document's images reference, in document order, without repeats. */
export const richTextMediaIds = (document: RichTextDocument): string[] => {
  const ids = new Set<string>();
  const walk = (node: RichTextNode) => {
    if (node.type === 'image' && typeof node.attrs?.mediaId === 'string') {
      ids.add(node.attrs.mediaId);
    }
    (node.content ?? []).forEach(walk);
  };
  walk(document.doc);
  return [...ids];
};
