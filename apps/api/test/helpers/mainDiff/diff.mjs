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
// A difference in what a step stored makes every later observation of that entry differ too, and every later
// snapshot number: those are consequences, counted but not reported. A root difference is the first difference of
// an entry (or of a step that names no diverged entry); every unlisted root fails the run.
const diverged = new Set();
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
  const found = differences({ ...a, label: undefined }, { ...b, label: undefined });
  if (found.length === 0) {
    continue;
  }
  // A create copies what its source entry read: from a diverged source, the new entry diverges too.
  const createdEntry = a?.createdEntry ?? b?.createdEntry;
  if (entry !== undefined && diverged.has(entry)) {
    if (createdEntry !== undefined) {
      diverged.add(String(createdEntry));
    }
    consequences += found.length;
    continue;
  }
  const dataDifferences = found.filter((difference) => /^\/entry\/heads\/\d+\/data\//.test(difference.path));
  const step = {
    branchIssues: b?.issues ?? [],
    keepsOnly: (b?.status ?? 500) < 300 && dataDifferences.length > 0 && dataDifferences.every(isKeep),
  };
  for (const difference of found) {
    if (diverged.size > 0 && difference.path === '/body/meta/snapshot') {
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
  if (entry !== undefined && found.some((difference) => difference.path.startsWith('/entry'))) {
    diverged.add(entry);
  }
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
