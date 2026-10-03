import type { ImportEntry, SourceValue } from './types.js';

/**
 * The order entries are created in: every entry after the entries it references, so references resolve at
 * creation. A reference that closes a cycle (an author ↔ article pair, a page that is its own ancestor) cannot
 * be satisfied that way: its top-level field is left out of the create and written by an update once every
 * entry exists (`deferred`). Iterative, so long parent chains do not exhaust the stack.
 */
export type WriteOrder = {
  entries: ImportEntry[];
  /** Field keys to leave out of the create and write afterwards, per entry source ID. */
  deferred: Map<string, Set<string>>;
};

const collectReferences = (value: SourceValue, into: string[]) => {
  switch (value.kind) {
    case 'entries':
      into.push(...value.sourceIds);
      break;
    case 'component':
      value.items.forEach((item) => Object.values(item).forEach((nested) => collectReferences(nested, into)));
      break;
    case 'zone':
      value.items.forEach((item) =>
        Object.values(item.fields).forEach((nested) => collectReferences(nested, into)),
      );
      break;
    default:
      break;
  }
};

/** Referenced entry source IDs, per top-level field key, across every locale of the entry. */
export const referencesByField = (entry: ImportEntry): Map<string, Set<string>> => {
  const byField = new Map<string, Set<string>>();
  for (const locale of entry.locales) {
    for (const [key, value] of Object.entries(locale.fields)) {
      const targets: string[] = [];
      collectReferences(value, targets);
      if (targets.length > 0) {
        const set = byField.get(key) ?? new Set<string>();
        targets.forEach((target) => set.add(target));
        byField.set(key, set);
      }
    }
  }
  return byField;
};

type Edge = { target: string; fields: string[] };

const edgesOf = (entry: ImportEntry, known: ReadonlySet<string>): Edge[] => {
  const byTarget = new Map<string, string[]>();
  for (const [field, targets] of referencesByField(entry)) {
    for (const target of targets) {
      if (known.has(target)) {
        byTarget.set(target, [...(byTarget.get(target) ?? []), field]);
      }
    }
  }
  return [...byTarget].map(([target, fields]) => ({ target, fields }));
};

const defer = (deferred: Map<string, Set<string>>, sourceId: string, fields: readonly string[]) => {
  const set = deferred.get(sourceId) ?? new Set<string>();
  fields.forEach((field) => set.add(field));
  deferred.set(sourceId, set);
};

export const writeOrder = (entries: readonly ImportEntry[]): WriteOrder => {
  const bySourceId = new Map(entries.map((entry) => [entry.sourceId, entry]));
  const known = new Set(bySourceId.keys());
  const state = new Map<string, 'visiting' | 'done'>();
  const ordered: ImportEntry[] = [];
  const deferred = new Map<string, Set<string>>();
  for (const root of entries) {
    if (state.has(root.sourceId)) {
      continue;
    }
    const stack: Array<{ entry: ImportEntry; edges: Edge[]; next: number }> = [
      { entry: root, edges: edgesOf(root, known), next: 0 },
    ];
    state.set(root.sourceId, 'visiting');
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const edge = frame.edges[frame.next];
      if (!edge) {
        stack.pop();
        state.set(frame.entry.sourceId, 'done');
        ordered.push(frame.entry);
        continue;
      }
      frame.next += 1;
      const status = state.get(edge.target);
      if (status === 'visiting') {
        defer(deferred, frame.entry.sourceId, edge.fields);
      } else if (status === undefined) {
        const target = bySourceId.get(edge.target)!;
        state.set(edge.target, 'visiting');
        stack.push({ entry: target, edges: edgesOf(target, known), next: 0 });
      }
    }
  }
  return { entries: ordered, deferred };
};
