// Compares the observations of main and the branch (written by workload.diff.ts) step by step. Every difference
// must match an entry of allowlist.json, each citing the CHANGELOG.md or documentation/upgrades.md line that tells
// users about it; any other difference is printed and fails the run (exit 1).
//
//   node diff.mjs <main.json> <branch.json> <allowlist.json>
import { readFileSync } from 'node:fs';

const say = (line) => process.stdout.write(`${line}\n`);

const [mainPath, branchPath, allowPath] = process.argv.slice(2);
const main = JSON.parse(readFileSync(mainPath, 'utf8'));
const branch = JSON.parse(readFileSync(branchPath, 'utf8'));
const allow = JSON.parse(readFileSync(allowPath, 'utf8'));

/** Every leaf path where two values differ, with both values. */
const differences = (a, b, path = '') => {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
  if (isObject(a) && isObject(b)) {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((key) =>
      differences(a[key], b[key], `${path}/${key}`),
    );
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    return a.flatMap((item, index) => differences(item, b[index], `${path}/${index}`));
  }
  return [{ path: path || '/', main: a, branch: b }];
};

/**
 * Whether an allowlist entry covers a difference: its step label, path and values match, and its `when` holds for
 * the whole step (`branchIssues`: the branch's issues match; `keepsOnly`: every stored-data difference of the step is
 * a value the branch kept that main lost, so the branch wrote less than main).
 */
const matches = (entry, label, difference, step) =>
  new RegExp(entry.step ?? '.*').test(label) &&
  new RegExp(entry.path ?? '.*').test(difference.path) &&
  (entry.main === undefined || new RegExp(entry.main).test(JSON.stringify(difference.main))) &&
  (entry.branch === undefined || new RegExp(entry.branch).test(JSON.stringify(difference.branch))) &&
  (entry.when?.branchIssues === undefined ||
    new RegExp(entry.when.branchIssues).test(JSON.stringify(step.branchIssues))) &&
  (entry.when?.keepsOnly !== true || step.keepsOnly);

/** A stored-data difference where the branch holds what main lost (main has nothing there, or fewer targets). */
const isKeep = (difference) =>
  difference.main === undefined ||
  (Array.isArray(difference.main) &&
    Array.isArray(difference.branch) &&
    difference.main.every((item) =>
      difference.branch.some((other) => JSON.stringify(other) === JSON.stringify(item)),
    ) &&
    difference.branch.length > difference.main.length);

const unlisted = [];
const listed = new Map();
// After an allowed difference in what a step stored, the entry's later observations differ in what that step
// touched: the fields it stored differently, and the counters (revisions, events, audit rows, versions, status,
// snapshot numbers) it moved on one side only. Those are consequences, counted but not reported. Everything else
// about the entry is still compared: other fields, every response's status, code and issues, and the per-step
// change of the counters. A create copies what its source read, so it inherits the source's touched fields.
const touched = new Map(); // entry → Set of top-level field names
const ABSOLUTE =
  /^\/(entry\/(revisions|events|audit|status)|entry\/heads\/[^/]+\/version|body\/meta\/snapshot|body\/locales\/\d+\/(version|status|publishedAt|sharedOutdated)|body\/(data\/)?(version|status|updatedAt|publishedAt))(\/|$)/;
const fieldOf = (path) =>
  /^\/entry\/heads\/[^/]+\/data\/([^/]+)/.exec(path)?.[1] ??
  /^\/(?:body\/data|body|sent)\/([^/]+)/.exec(path)?.[1];
/** A head present on one side only: `/entry/heads/fr|draft`. */
const headOf = (path) => /^\/entry\/heads\/([^/]+)$/.exec(path)?.[1];
const isTouched = (fields, path) => {
  if (ABSOLUTE.test(path)) return true;
  const head = /^\/entry\/heads\/([^/]+)/.exec(path)?.[1];
  if (head !== undefined && fields.has(`head:${head}`)) return true;
  if (headOf(path) !== undefined) return false;
  const field = fieldOf(path);
  return field !== undefined && fields.has(field);
};
/** A step with its heads keyed by locale and state (`en|draft`), so a head on one side only is one path. */
const keyed = (step) =>
  step && {
    ...step,
    label: undefined,
    entry: step.entry && {
      ...step.entry,
      heads: Object.fromEntries(step.entry.heads.map((head) => [`${head.locale}|${head.state}`, head])),
    },
  };
const previous = { main: new Map(), branch: new Map() };
const deltas = (side, entry, observed) => {
  if (!observed) return undefined;
  const last = previous[side].get(entry);
  previous[side].set(entry, observed);
  return last
    ? { revisions: observed.revisions - last.revisions, events: observed.events.length - last.events.length }
    : undefined;
};
/** Remembers what a step stored differently on the two sides (its fields, and heads on one side only). */
const recordTouched = (entry, raw, createdEntry) => {
  if (entry !== undefined && raw.some((difference) => difference.path.startsWith('/entry'))) {
    const set = touched.get(entry) ?? new Set();
    for (const difference of raw) {
      const head = headOf(difference.path);
      if (head !== undefined) {
        set.add(`head:${head}`);
        set.add('locales');
      }
      const field = fieldOf(difference.path);
      if (field !== undefined && difference.path.startsWith('/entry')) set.add(field);
    }
    touched.set(entry, set);
    if (createdEntry !== undefined) touched.set(String(createdEntry), new Set(set));
  }
};
let consequences = 0;
const count = Math.max(main.length, branch.length);
for (let index = 0; index < count; index += 1) {
  const a = main[index];
  const b = branch[index];
  const label = a?.label ?? b?.label ?? `${index}`;
  if (a?.label !== b?.label) {
    unlisted.push({ label, path: '/label', main: a?.label, branch: b?.label });
    break; // the workloads diverged: nothing after this compares
  }
  const entry = /\be(\d+)\b/.exec(label)?.[1];
  const createdEntry = a?.createdEntry ?? b?.createdEntry;
  // A create observes the new entry: its counters start there.
  const observedKey = createdEntry !== undefined ? String(createdEntry) : entry;
  const deltaA = observedKey !== undefined ? deltas('main', observedKey, a?.entry) : undefined;
  const deltaB = observedKey !== undefined ? deltas('branch', observedKey, b?.entry) : undefined;
  let found = differences(keyed(a), keyed(b));
  const raw = found;
  const fields = entry !== undefined ? touched.get(entry) : undefined;
  if (fields) {
    if (createdEntry !== undefined) {
      touched.set(String(createdEntry), new Set(fields));
    }
    const before = found.length;
    // A locale whose head exists on one side only: every step in that locale is a consequence, and so are the
    // per-step counters (a shared field's write reaches that locale's head on one side only).
    const locale = /\b(?:doc|ndoc) (\w+)\b/.exec(label)?.[1];
    const headSides = [...fields].filter((key) => key.startsWith('head:'));
    // A write that names a touched field starts from different values: its counters are consequences too.
    const writesTouched = [a?.sent, b?.sent].some(
      (sent) => sent && typeof sent === 'object' && Object.keys(sent).some((key) => fields.has(key)),
    );
    const localeGone = headSides.some((key) => key.startsWith(`head:${locale}|`));
    found = localeGone
      ? []
      : [
          ...found.filter((difference) => !isTouched(fields, difference.path)),
          ...(headSides.length === 0 && !writesTouched ? differences(deltaA, deltaB, '/entry/perStep') : []),
        ];
    consequences +=
      before - found.filter((difference) => !difference.path.startsWith('/entry/perStep')).length;
  }
  if (found.length === 0) {
    recordTouched(entry, raw, createdEntry);
    continue;
  }
  const dataDifferences = found.filter((difference) =>
    /^\/entry\/heads\/[^/]+\/data\//.test(difference.path),
  );
  const step = {
    branchIssues: b?.issues ?? [],
    keepsOnly: (b?.status ?? 500) < 300 && dataDifferences.length > 0 && dataDifferences.every(isKeep),
  };
  for (const difference of found) {
    if (touched.size > 0 && difference.path === '/body/meta/snapshot') {
      consequences += 1;
      continue;
    }
    const allowed = allow.find((candidate) => matches(candidate, label, difference, step));
    if (allowed) {
      listed.set(allowed.id, (listed.get(allowed.id) ?? 0) + 1);
    } else {
      unlisted.push({ label, ...difference });
    }
  }
  recordTouched(entry, raw, createdEntry);
}
say(`${consequences} later difference(s) are consequences of an earlier one on the same entry`);
for (const [id, times] of listed) say(`allowed ${id}: ${times}`);
if (unlisted.length > 0) {
  say(`${unlisted.length} unlisted difference(s):`);
  for (const difference of unlisted.slice(0, 200)) {
    say(
      `- ${difference.label} ${difference.path}: main ${JSON.stringify(difference.main)?.slice(0, 160)} | branch ${JSON.stringify(difference.branch)?.slice(0, 160)}`,
    );
  }
  process.exit(1);
}
say(`no unlisted differences over ${count} steps`);
