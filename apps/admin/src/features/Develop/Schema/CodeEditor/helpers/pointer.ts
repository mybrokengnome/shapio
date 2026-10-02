import { ensureSyntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';

/**
 * Maps a JSON pointer (`/fields/2/apiKey`, the `path` of a `ValidationIssue`) to a range of the document
 * through the lezer JSON tree, so a server-side validator's issue lands on the text it is about.
 * A pointer that resolves fully marks the property's value when it is a scalar, else the property name;
 * one that stops early (a missing property) marks the deepest property found, or the object's brace.
 */
export type TextRange = { from: number; to: number };

const VALUE_NODES: ReadonlySet<string> = new Set([
  'Object',
  'Array',
  'String',
  'Number',
  'True',
  'False',
  'Null',
]);
const CONTAINERS: ReadonlySet<string> = new Set(['Object', 'Array']);

/** How long to wait for a full parse of large files (the linter runs off the input path). */
const PARSE_TIMEOUT_MS = 200;

const children = (node: SyntaxNode): SyntaxNode[] => {
  const found: SyntaxNode[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    found.push(child);
  }
  return found;
};

const valueOf = (node: SyntaxNode): SyntaxNode | undefined =>
  children(node).find((child) => VALUE_NODES.has(child.name));

const decodeSegment = (segment: string) => segment.replace(/~1/g, '/').replace(/~0/g, '~');

const propertyName = (state: EditorState, property: SyntaxNode): string | undefined => {
  const name = children(property).find((child) => child.name === 'PropertyName');
  if (!name) {
    return undefined;
  }
  try {
    return JSON.parse(state.sliceDoc(name.from, name.to)) as string;
  } catch {
    return undefined;
  }
};

/** The first line of a node (objects and arrays span many lines; marking all of them is noise). */
const firstLine = (state: EditorState, node: SyntaxNode): TextRange => {
  const line = state.doc.lineAt(node.from);
  return { from: node.from, to: Math.max(node.from + 1, Math.min(node.to, line.to)) };
};

type Step = { node: SyntaxNode; mark: TextRange };

const stepInto = (state: EditorState, node: SyntaxNode, segment: string): Step | undefined => {
  if (node.name === 'Object') {
    const property = children(node).find(
      (child) => child.name === 'Property' && propertyName(state, child) === segment,
    );
    const value = property ? valueOf(property) : undefined;
    const name = property ? children(property).find((child) => child.name === 'PropertyName') : undefined;
    return property && value && name ? { node: value, mark: { from: name.from, to: name.to } } : undefined;
  }
  if (node.name === 'Array' && /^\d+$/.test(segment)) {
    const item = children(node).filter((child) => VALUE_NODES.has(child.name))[Number(segment)];
    return item ? { node: item, mark: firstLine(state, item) } : undefined;
  }
  return undefined;
};

export const rangeOfPointer = (state: EditorState, pointer: string): TextRange => {
  const tree = ensureSyntaxTree(state, state.doc.length, PARSE_TIMEOUT_MS);
  const root = tree ? valueOf(tree.topNode) : undefined;
  if (!root) {
    return { from: 0, to: Math.min(1, state.doc.length) };
  }
  const segments = pointer === '' ? [] : pointer.split('/').slice(1).map(decodeSegment);
  let current: Step = { node: root, mark: firstLine(state, root) };
  for (const segment of segments) {
    const next = stepInto(state, current.node, segment);
    if (!next) {
      return current.mark;
    }
    current = next;
  }
  return CONTAINERS.has(current.node.name) ? current.mark : { from: current.node.from, to: current.node.to };
};
