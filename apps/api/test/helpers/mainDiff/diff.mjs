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

// Every allowlist entry cites the docs by quoted text (whitespace-insensitive): a cited phrase that is no longer
// in its file fails the run, so the docs and the allowlist cannot drift apart.
const repo = new URL('../../../../../', import.meta.url);
const flat = (text) => text.replace(/\s+/g, ' ');
const stale = allow.flatMap((entry) =>
  (entry.cites ?? [])
    .filter(({ file, text }) => !flat(readFileSync(new URL(file, repo), 'utf8')).includes(flat(text)))
    .map(({ file, text }) => `${entry.id}: "${text}" is not in ${file}`),
);
if (allow.some((entry) => !Array.isArray(entry.cites) || entry.cites.length === 0)) {
  say('every allowlist entry needs at least one citation (cites: [{ file, text }])');
  process.exit(1);
}
for (const line of stale) say(`cited text missing: ${line}`);

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
 * the step. The `when` conditions come from what the workload worked out before the write, from the stored data
 * and the caller (`pre`), never from the response:
 * - `unseenHidden`: the caller cannot see the draft it writes (the draft is ahead of what it may read, or it
 *   cannot read the entry), and every AMBIGUOUS_ITEMS issue of the branch is on a field whose items can hold
 *   values hidden from it;
 * - `hiddenKept`: the branch accepted the write, and every stored-data difference of the step is a value hidden
 *   from the caller (a private sub-field, or a relation target it cannot read) that the branch kept and main lost.
 */
const matches = (entry, label, difference, step) =>
  new RegExp(entry.step ?? '.*').test(label) &&
  new RegExp(entry.path ?? '.*').test(difference.path) &&
  (entry.main === undefined || new RegExp(entry.main).test(JSON.stringify(difference.main))) &&
  (entry.branch === undefined || new RegExp(entry.branch).test(JSON.stringify(difference.branch))) &&
  (entry.when?.branchIssues === undefined ||
    new RegExp(entry.when.branchIssues).test(JSON.stringify(step.branchIssues))) &&
  (entry.when?.unseenHidden !== true || step.unseenHidden) &&
  (entry.when?.noIdItems !== true || step.noIdItems) &&
  (entry.when?.refusalOrder !== true || step.refusalOrder) &&
  (entry.when?.staleHidden !== true || step.staleHidden) &&
  (entry.when?.unclaimedHidden !== true || step.unclaimedHidden) &&
  (entry.when?.noopHiddenKept !== true || step.noopHiddenKept) &&
  (entry.when?.hiddenKept !== true || step.hiddenKept);

const RELATIONS = new Set(['rel', 'rels', 'ref']);
/** The last named segment of a path (`/entry/heads/en|draft/data/cards/0/rels/1` → `rels`). */
const leafOf = (path) =>
  path
    .split('/')
    .filter((segment) => !/^\d+$/.test(segment))
    .at(-1);

/** A stored-data difference where the branch holds a value hidden from the caller that main lost. */
const isHiddenKeep = (difference, pre) => {
  if (!pre) return false;
  const leaf = leafOf(difference.path);
  if (pre.hiddenLeaves.includes(leaf)) {
    return difference.main === undefined && difference.branch !== undefined;
  }
  if (!RELATIONS.has(leaf)) return false;
  const hidden = (value) => pre.hiddenTargets.includes(value);
  if (!Array.isArray(difference.branch)) {
    return difference.main === undefined && hidden(difference.branch);
  }
  const main = Array.isArray(difference.main) ? difference.main : [];
  const kept = difference.branch.filter((target) => !main.includes(target));
  return main.every((target) => difference.branch.includes(target)) && kept.length > 0 && kept.every(hidden);
};

/** The step-level conditions of the allowlist, from the branch's `pre` and issues. */
/** Whether every stored difference from `before` to `after` (one side's observations) is a hidden value lost. */
const onlyLostHidden = (before, after, hiddenLeaves) => {
  if (!after) return false;
  const heads = (observed) =>
    Object.fromEntries(observed.heads.map((head) => [`${head.locale}|${head.state}`, head.data]));
  const changed = differences(heads(before), heads(after));
  return (
    changed.length > 0 &&
    changed.every(
      (difference) => hiddenLeaves.includes(leafOf(difference.path)) && difference.branch === undefined,
    )
  );
};

const conditionsOf = (label, main, b, dataDifferences) => {
  const pre = b?.pre ?? null;
  const ambiguous = (b?.issues ?? []).filter((issue) => issue.startsWith('AMBIGUOUS_ITEMS '));
  return {
    branchIssues: b?.issues ?? [],
    unseenHidden:
      pre !== null &&
      !pre.seesDraft &&
      ambiguous.length > 0 &&
      ambiguous.every((issue) => pre.hiddenFields.includes(issue.split(' ')[1].split('/')[1])),
    // upgrades.md:48-50: an app user's or anonymous caller's list sent without `id`s, on a field whose items can
    // hold values hidden from it.
    noIdItems:
      pre !== null &&
      ambiguous.length > 0 &&
      ambiguous.every((issue) => {
        const field = issue.split(' ')[1].split('/')[1];
        return pre.hiddenFields.includes(field) && pre.withoutIds.includes(field);
      }),
    // upgrades.md:72-73: existence and ownership come before the body, so an entry that is not the caller's is
    // 404 (or 403) where main, which checked the body first, answered a body error.
    refusalOrder: pre !== null && pre.notTheirs && main?.status === 422 && [403, 404].includes(b?.status),
    // A stale retry (review 11): every UNKNOWN_ITEM_ID is on a list whose items can hold values hidden from the
    // caller (the list's name: the last named segment before the item index).
    staleHidden:
      pre !== null &&
      / stale /.test(label) &&
      (b?.issues ?? []).length > 0 &&
      (b?.issues ?? []).every((issue) => {
        const [code, path] = issue.split(' ');
        const segments = path.split('/').filter(Boolean);
        const list = segments[segments.length - 3];
        return code === 'UNKNOWN_ITEM_ID' && segments.at(-1) === 'id' && pre.hiddenFields.includes(list);
      }),
    // A copy or move (review 13) that would leave a stored item unclaimed: every issue is UNKNOWN_ITEM_ID on such a
    // list, the list's items can hold values hidden from the caller, and the caller sees the draft.
    unclaimedHidden:
      pre !== null &&
      pre.seesDraft &&
      Array.isArray(pre.unclaimed) &&
      (b?.issues ?? []).length > 0 &&
      (b?.issues ?? []).every((issue) => {
        const [code, path] = issue.split(' ');
        const list = path.split('/').filter(Boolean)[0];
        return code === 'UNKNOWN_ITEM_ID' && pre.unclaimed.includes(list) && pre.hiddenFields.includes(list);
      }),
    hiddenKept:
      (b?.status ?? 500) < 300 &&
      dataDifferences.length > 0 &&
      dataDifferences.every((difference) => isHiddenKeep(difference, pre)),
  };
};

const unlisted = [];
const listed = new Map();
// After an allowed difference in what a step stored, the entry's later observations differ in what that step
// touched: the fields it stored differently, and the counters (revisions, events, audit rows, versions, status,
// snapshot numbers) it moved on one side only. Those are consequences, counted but not reported. Everything else
// about the entry is still compared: other fields, every response's status, code and issues, and the per-step
// change of the counters. A create copies what its source read, so it inherits the source's touched fields.
const touched = new Map(); // entry → Set of top-level field names
const ABSOLUTE =
  /^\/(entry\/(revisions|events|audit|status)|entry\/heads\/[^/]+\/version|body\/meta\/snapshot|(body|deView)\/locales\/\d+\/(version|status|publishedAt)|(body|deView)\/(data\/)?(version|status|updatedAt|publishedAt))(\/|$)/;
const fieldOf = (path) =>
  /^\/entry\/heads\/[^/]+\/data\/([^/]+)/.exec(path)?.[1] ??
  /^\/(?:body\/data|deView\/data|body|sent)\/([^/]+)/.exec(path)?.[1];
/** A head present on one side only: `/entry/heads/fr|draft`. */
const headOf = (path) => /^\/entry\/heads\/([^/]+)$/.exec(path)?.[1];
// Fields shared by every locale (not localized) in the seed's models.
const SHARED = new Set(['cards', 'hero', 'zone', 'ref', 'sitems']);
// Entries where a hidden value was kept on a shared field (allowed `hidden-values-kept`): main wiped it in every
// locale's draft, so main reports those locales outdated against their published heads and the branch does not.
// The same after an allowed refusal of a write to a shared list (main accepted it). Only there is a
// `sharedOutdated` difference a consequence (upgrades.md:56-60, CHANGELOG.md:125).
const keptShared = new Set();
const isTouched = (fields, path, entry) => {
  if (/sharedOutdated/.test(path)) return keptShared.has(entry);
  if (ABSOLUTE.test(path)) return true;
  const head = /^\/entry\/heads\/([^/]+)/.exec(path)?.[1];
  if (head !== undefined && fields.has(`head:${head}`)) return true;
  if (headOf(path) !== undefined) return false;
  const field = fieldOf(path);
  return field !== undefined && fields.has(field);
};
/** A step with its heads keyed by locale and state (`en|draft`), so a head on one side only is one path. */
// The audit log is one count for the whole database, so after any difference anywhere its absolute value differs on
// every later step: each step's audit rows are compared as the number that step added.
const lastAudit = new Map();
const keyed = (step, side) => {
  if (!step) return step;
  let audit;
  if (step.entry && typeof step.entry.audit === 'number') {
    audit = step.entry.audit - (lastAudit.get(side) ?? step.entry.audit);
    lastAudit.set(side, step.entry.audit);
  }
  return {
    ...step,
    label: undefined,
    pre: undefined,
    baseline: undefined,
    copies: undefined,
    entry: step.entry && {
      ...step.entry,
      audit,
      heads: Object.fromEntries(step.entry.heads.map((head) => [`${head.locale}|${head.state}`, head])),
    },
  };
};
const previous = { main: new Map(), branch: new Map() };
// A step that prepares the entry itself first (the copy/move step publishes it) reports the counts after that
// preparation as `baseline`: its own write is then measured from there, so an earlier allowed difference that left
// the entry modified on one side only does not show as a difference in what the step's write did.
const deltas = (side, entry, observed, baseline) => {
  if (!observed) return undefined;
  const last = baseline ?? previous[side].get(entry);
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
  // What main stored when the step's own write began (after any preparation the step made itself).
  const mainBefore = a?.baseline?.heads
    ? a.baseline
    : observedKey !== undefined
      ? previous.main.get(observedKey)
      : undefined;
  const deltaA = observedKey !== undefined ? deltas('main', observedKey, a?.entry, a?.baseline) : undefined;
  const deltaB = observedKey !== undefined ? deltas('branch', observedKey, b?.entry, b?.baseline) : undefined;
  let found = differences(keyed(a, 'main'), keyed(b, 'branch'));
  const raw = found;
  // A copy (review 14) of a field that already differs between the sides (an earlier allowed difference touched it
  // in the entry the step copies from, this one or another): what lands in the destination field differs as a
  // consequence. Only that field's values are consequences; status, issues and every other field still compare.
  const copiedFields = new Set(
    (b?.copies ?? []).filter(({ from, field }) => touched.get(String(from))?.has(field)).map(({ to }) => to),
  );
  if (copiedFields.size > 0) {
    const before = found.length;
    found = found.filter(
      (difference) =>
        !(
          /^\/(entry\/heads\/[^/]+\/data|body\/data|sent)\//.test(difference.path) &&
          copiedFields.has(fieldOf(difference.path))
        ),
    );
    consequences += before - found.length;
  }
  const fields = entry !== undefined ? touched.get(entry) : undefined;
  if (fields) {
    if (createdEntry !== undefined) {
      touched.set(String(createdEntry), new Set(fields));
    }
    const before = found.length;
    // A stale step whose other writer changed the entry on one side only (an earlier allowed difference made its
    // change a no-op there): whether the first write is stale follows from that, so it is a consequence.
    if (a?.otherMoved !== b?.otherMoved) {
      found = found.filter((difference) => !/^\/(firstStatus|otherMoved|otherStatus)$/.test(difference.path));
    }
    // A locale whose head exists on one side only: every step in that locale is a consequence, and so are the
    // per-step counters (a shared field's write reaches that locale's head on one side only).
    const locale = /\b(?:doc|ndoc|ldoc) (\w+)\b/.exec(label)?.[1];
    const headSides = [...fields].filter((key) => key.startsWith('head:'));
    // A write that names a touched field starts from different values: its counters are consequences too.
    const writesTouched = [a?.sent, b?.sent].some(
      (sent) => sent && typeof sent === 'object' && Object.keys(sent).some((key) => fields.has(key)),
    );
    const localeGone = headSides.some((key) => key.startsWith(`head:${locale}|`));
    found = localeGone
      ? []
      : [
          ...found.filter((difference) => !isTouched(fields, difference.path, entry)),
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
    ...conditionsOf(label, a, b, dataDifferences),
    // A write the branch treats as a no-op that keeps hidden values (review 14): every sent item equals exactly one
    // stored item in the caller's view (worked out by the workload from what the caller read), the branch recorded
    // nothing, and main's only stored change is the loss of values hidden from the caller.
    noopHiddenKept:
      b?.pre?.contentMatch === true &&
      deltaB?.revisions === 0 &&
      deltaB?.events === 0 &&
      mainBefore !== undefined &&
      onlyLostHidden(mainBefore, a?.entry, b.pre.hiddenLeaves),
  };
  for (const difference of found) {
    if (touched.size > 0 && difference.path === '/body/meta/snapshot') {
      consequences += 1;
      continue;
    }
    const allowed = allow.find((candidate) => matches(candidate, label, difference, step));
    if (allowed) {
      listed.set(allowed.id, (listed.get(allowed.id) ?? 0) + 1);
      if (
        allowed.id === 'hidden-values-kept' &&
        entry !== undefined &&
        SHARED.has(fieldOf(difference.path))
      ) {
        keptShared.add(entry);
      }
      // An allowed refusal of a write that named a shared field: main wrote it in every locale's draft, the branch
      // did not.
      if (
        allowed.id !== 'hidden-values-kept' &&
        entry !== undefined &&
        (b?.status ?? 0) >= 400 &&
        Object.keys(b?.sent ?? {}).some((field) => SHARED.has(field))
      ) {
        keptShared.add(entry);
      }
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
if (stale.length > 0) process.exit(1);
