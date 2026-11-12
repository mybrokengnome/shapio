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
  (entry.when?.unsentDeadTarget !== true || step.unsentDeadTarget) &&
  (entry.when?.hiddenOverMax !== true || step.hiddenOverMax) &&
  (entry.when?.unsentNotRechecked !== true || step.unsentNotRechecked) &&
  (entry.when?.noopAfterAllowed !== true || step.noopAfterAllowed) &&
  (entry.when?.hiddenKept !== true || step.hiddenKept);

// Relation fields of the seed's types (`dref`, `dmtop`, `mixd`/`mixn`, `dlow` included), and media fields.
const RELATIONS = new Set(['rel', 'rels', 'ref', 'relsA', 'relsB', 'refB']);
const MEDIA = new Set(['pics', 'picsA', 'picsB', 'picB']);
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
  // (A caller without a read grant on things can see no relation target at all.)
  const hidden = (value) => pre.allTargetsHidden === true || pre.hiddenTargets.includes(value);
  if (!Array.isArray(difference.branch)) {
    return difference.main === undefined && hidden(difference.branch);
  }
  const main = Array.isArray(difference.main) ? difference.main : [];
  const kept = difference.branch.filter((target) => !main.includes(target));
  return main.every((target) => difference.branch.includes(target)) && kept.length > 0 && kept.every(hidden);
};

/** The step-level conditions of the allowlist, from the branch's `pre` and issues. */
/** Whether every stored difference from `before` to `after` (one side's observations) is a hidden value lost. */
/**
 * A relation or media value that lost only targets hidden from the caller or no longer live (review 15: "A kept target that has
 * since been deleted is not kept: the next write that changes something drops it, as before 0.9.0").
 */
const lostDeadTargets = (difference, deadTargets, hidden = { targets: [], all: false }) => {
  if (!RELATIONS.has(leafOf(difference.path)) && !MEDIA.has(leafOf(difference.path))) return false;
  const before = Array.isArray(difference.main) ? difference.main : [difference.main];
  const after = Array.isArray(difference.branch)
    ? difference.branch
    : difference.branch == null
      ? []
      : [difference.branch];
  const removed = before.filter((target) => !after.includes(target));
  return (
    removed.length > 0 &&
    removed.every(
      (target) =>
        deadTargets.includes(target) ||
        (RELATIONS.has(leafOf(difference.path)) && (hidden.all || hidden.targets.includes(target))),
    ) &&
    after.every((target) => before.includes(target))
  );
};

/** Whether every stored difference from `before` to `after` is in one of `fields` (a draft's top-level field). */
const onlyFields = (before, after, fields) => {
  if (!after) return false;
  const heads = (observed) =>
    Object.fromEntries(observed.heads.map((head) => [`${head.locale}|${head.state}`, head.data]));
  return differences(heads(before), heads(after)).every((difference) =>
    fields.includes(difference.path.split('/')[2]),
  );
};

/** JSON with object keys sorted, so stored values and sent ones compare whatever their key order. */
const canonical = (value) =>
  JSON.stringify(value, (_key, inner) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.keys(inner)
            .sort()
            .map((key) => [key, inner[key]]),
        )
      : inner,
  );
/** The data of one side's draft head in a locale (`observed` as a step records it). */
const draftOf = (observed, locale) =>
  observed?.heads?.find((head) => head.locale === locale && head.state === 'draft')?.data;

const onlyLostHidden = (
  before,
  after,
  hiddenLeaves,
  deadTargets = [],
  hidden = { targets: [], all: false },
) => {
  if (!after) return false;
  const heads = (observed) =>
    Object.fromEntries(observed.heads.map((head) => [`${head.locale}|${head.state}`, head.data]));
  const changed = differences(heads(before), heads(after));
  return (
    changed.length > 0 &&
    changed.every(
      (difference) =>
        (hiddenLeaves.includes(leafOf(difference.path)) && difference.branch === undefined) ||
        lostDeadTargets(difference, deadTargets, hidden),
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
    // A step that prepares itself (a setup publish) is charged only the rows its own write added.
    const from = typeof step.baseline?.audit === 'number' ? step.baseline.audit : lastAudit.get(side);
    audit = step.entry.audit - (from ?? step.entry.audit);
    lastAudit.set(side, step.entry.audit);
  }
  return {
    ...step,
    label: undefined,
    pre: undefined,
    baseline: undefined,
    copies: undefined,
    alsoObserved: undefined,
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
// Entries whose branch kept dead targets through an allowed no-op (review 16), and which ones.
const keptDead = new Map();
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
  const branchBefore = b?.baseline?.heads
    ? b.baseline
    : observedKey !== undefined
      ? previous.branch.get(observedKey)
      : undefined;
  // What main stored when the step's own write began (after any preparation the step made itself).
  // Observations a step made of other entries (a copy's source after the step's setup publish): they move those
  // entries' counters, so their next step is measured from here.
  for (const [side, step] of [
    ['main', a],
    ['branch', b],
  ]) {
    for (const { entry: other, observed } of step?.alsoObserved ?? []) {
      if (String(other) !== entry) previous[side].set(String(other), observed);
    }
  }
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
  // An admin API echo of dead ids the branch kept through an allowed no-op (review 16): its refusal on exactly those
  // ids is a consequence (main had dropped them, so its echo held none). Anything else on the entry still compares.
  const kept = entry !== undefined ? keptDead.get(entry) : undefined;
  if (
    kept &&
    / admin /.test(label) &&
    (b?.issues ?? []).length > 0 &&
    b.issues.every((issue) => {
      const [code, path] = issue.split(' ');
      if (code !== 'RELATION_TARGET_MISSING' && code !== 'MEDIA_MISSING') return false;
      const value = path
        .split('/')
        .filter(Boolean)
        .reduce((at, key) => (at === undefined || at === null ? undefined : at[key]), b?.sent);
      const ids = (Array.isArray(value) ? value : [value]).map(String);
      return (
        ids.some((id) => kept.has(id)) &&
        ids.every((id) => kept.has(id) || !(b?.pre?.deadTargets ?? []).includes(id))
      );
    })
  ) {
    consequences += found.length;
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
      onlyLostHidden(mainBefore, a?.entry, b.pre.hiddenLeaves, b.pre.deadTargets ?? [], {
        targets: b.pre.hiddenTargets ?? [],
        all: b.pre.allTargetsHidden === true,
      }),
    // Both sides refuse; the branch names a subset of main's issues, and every issue only main names is a dead
    // relation target or asset in a field the body did not send (not checked again on the branch).
    unsentNotRechecked:
      a?.status === 422 &&
      b?.status === 422 &&
      (b?.issues ?? []).every((issue) => (a?.issues ?? []).includes(issue)) &&
      (a?.issues ?? [])
        .filter((issue) => !(b?.issues ?? []).includes(issue))
        .every((issue) => {
          const [code, path] = issue.split(' ');
          return (
            (code === 'RELATION_TARGET_MISSING' || code === 'MEDIA_MISSING') &&
            !Object.keys(b?.sent ?? {}).includes(path.split('/')[1])
          );
        }),
    // Known limit (review 16): every branch issue is TOO_MANY on a field where what is sent fits `max` but the live
    // values hidden from the caller that the branch keeps push it over (worked out from the stored draft).
    hiddenOverMax:
      Array.isArray(b?.pre?.overMax) &&
      (b?.issues ?? []).length > 0 &&
      b.issues.every((issue) => {
        const [code, path] = issue.split(' ');
        return code === 'TOO_MANY' && b.pre.overMax.includes(path);
      }),
    // A write main refused only because a field the body did not send holds a dead target (review 15): main's
    // issues are all RELATION_TARGET_MISSING on fields the body did not send, the branch accepted, and the branch
    // changed only fields the body sent.
    unsentDeadTarget:
      a?.status === 422 &&
      (a?.issues ?? []).length > 0 &&
      a.issues.every((issue) => {
        const [code, path] = issue.split(' ');
        return code === 'RELATION_TARGET_MISSING' && !Object.keys(b?.sent ?? {}).includes(path.split('/')[1]);
      }) &&
      (b?.status ?? 500) < 300 &&
      branchBefore !== undefined &&
      onlyFields(branchBefore, b?.entry, Object.keys(b?.sent ?? {})),
    // An admin save that is unchanged on the branch only because an earlier allowed difference already stored the
    // change there: the body equals the branch's stored draft in every field it sends, the branch stored nothing,
    // main's draft differs from the body only in fields that earlier difference touched, and main refused only for
    // dead relation targets or assets (it validated a real change; on the branch there was none to validate).
    noopAfterAllowed: (() => {
      const locale = / e\d+ \w+ (\w+) /.exec(label)?.[1];
      const sent = b?.sent && typeof b.sent === 'object' ? b.sent : null;
      const branchDraft = draftOf(branchBefore, locale);
      const mainDraft = draftOf(mainBefore, locale);
      if (!/ admin /.test(label) || !sent || !branchDraft || !mainDraft || !fields) return false;
      const keys = Object.keys(sent);
      const movedOnMain = keys.filter((key) => canonical(mainDraft[key]) !== canonical(sent[key]));
      return (
        (b?.status ?? 500) < 300 &&
        deltaB?.revisions === 0 &&
        deltaB?.events === 0 &&
        canonical(b?.entry?.heads) === canonical(branchBefore.heads) &&
        keys.every((key) => canonical(branchDraft[key]) === canonical(sent[key])) &&
        movedOnMain.length > 0 &&
        movedOnMain.every((key) => fields.has(key)) &&
        a?.status === 422 &&
        (a?.issues ?? []).length > 0 &&
        a.issues.every((issue) => {
          const [code, path] = issue.split(' ');
          if (code !== 'RELATION_TARGET_MISSING' && code !== 'MEDIA_MISSING') return false;
          const value = path
            .split('/')
            .filter(Boolean)
            .reduce((at, key) => (at === undefined || at === null ? undefined : at[key]), {
              ...mainDraft,
              ...sent,
            });
          return (Array.isArray(value) ? value : [value]).some((id) =>
            (b?.pre?.deadTargets ?? []).includes(id),
          );
        })
      );
    })(),
  };
  for (const difference of found) {
    if (touched.size > 0 && difference.path === '/body/meta/snapshot') {
      consequences += 1;
      continue;
    }
    const allowed = allow.find((candidate) => matches(candidate, label, difference, step));
    if (allowed?.id === 'noop-hidden-kept' && entry !== undefined) {
      // The kept value holds dead targets or assets: remember them (main dropped them, the branch kept them).
      const kept = JSON.stringify(b?.entry?.heads ?? []);
      const deadKept = (b?.pre?.deadTargets ?? []).filter((id) => kept.includes(id));
      if (deadKept.length > 0) keptDead.set(entry, new Set([...(keptDead.get(entry) ?? []), ...deadKept]));
    }
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
