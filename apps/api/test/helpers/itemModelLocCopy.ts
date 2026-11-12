import { isDeepStrictEqual } from 'node:util';
import { expectStatus } from './content.js';
import { wholeEcho } from './itemModelEchoAhead.js';
import { idUniqueness, legacyOf, readAs, send, storeHeads, type Problem } from './itemModelRun.js';
import { headsOf, type Caller, type World } from './itemModelWorld.js';

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * LOCCOPY (review 10): copies between locales. A client reads `en` and `fr`, then writes `fr` with its own items
 * plus `en`'s, or `en` with `fr`'s, sending the reads' `id`s. `lchips` is localized and its component (`chip`) has a
 * private sub-field; `cards` is shared. The entry is fully published (`published`) or has `fr` ahead of its
 * published head (`frAhead`).
 *
 * The rule (upgrades.md:64-71): an `id` read from another locale is a new item. A caller that sees the draft it
 * writes (an admin-kind caller always; an app user or anonymous caller when that locale's draft is not ahead of
 * what it reads) is accepted. A caller that cannot see it may instead be refused with `AMBIGUOUS_ITEMS` on a list
 * whose items can hold values hidden from it. Never `UNKNOWN_ITEM_ID` for an `id` the caller read.
 */
export type LocCopyEntry = 'published' | 'frAhead';
export type LocCopyVariant = 'toFr' | 'toEn';

export const locCopyEntry = async (w: World, kind: LocCopyEntry, legacy: 'all' | 'with') => {
  const id = expectStatus(
    await w.admin.post(`/api/admin/content/${w.docKey}?locale=en`, {
      locale: 'en',
      data: {
        title: 'en',
        lchips: [
          { zv: 'e1', zh: 'h1' },
          { zv: 'e2', zh: 'h2' },
        ],
        cards: [{ heading: 'A', note: 'n' }],
      },
    }),
    201,
  ).json<{ id: string }>().id;
  expectStatus(
    await w.admin.put(`/api/admin/content/${w.docKey}/${id}?locale=fr`, {
      locale: 'fr',
      expectedVersion: null,
      data: { title: 'fr', lchips: [{ zv: 'f1', zh: 'fh1' }] },
    }),
    200,
  );
  expectStatus(
    await w.admin.post(`/api/admin/content/${w.docKey}/${id}/publish`, { locales: ['en', 'fr'] }),
    200,
  );
  if (kind === 'frAhead') {
    const view = (await w.request('GET', `/api/admin/content/${w.docKey}/${id}?locale=fr`, w.adminToken))
      .body as Json;
    const chips = ((view.data as Json | undefined)?.lchips as Json[] | undefined) ?? [];
    expectStatus(
      await w.admin.put(`/api/admin/content/${w.docKey}/${id}?locale=fr`, {
        locale: 'fr',
        expectedVersion: view.version,
        data: { lchips: [...chips, { zv: 'f2', zh: 'fh2' }] },
      }),
      200,
    );
  }
  await storeHeads(w, id, (head) => legacyOf(head.data, legacy, 10));
  return id;
};

const issuesOf = (body: unknown): Array<{ code: string; path: string }> => {
  const error = isRecord(body) && isRecord(body.error) ? body.error : null;
  const details = error && isRecord(error.details) ? error.details : null;
  return details && Array.isArray(details.issues)
    ? (details.issues as Json[]).map((issue) => ({ code: String(issue.code), path: String(issue.path) }))
    : [];
};

const chipsOf = (data: unknown): Json[] =>
  isRecord(data) && Array.isArray(data.lchips) ? (data.lchips as Json[]).filter(isRecord) : [];

export const locCopyProblems = async (
  w: World,
  caller: Caller,
  entryId: string,
  { kind, variant, version }: { kind: LocCopyEntry; variant: LocCopyVariant; version: boolean },
): Promise<Problem[]> => {
  const label = `${caller.name}${version ? '@V' : ''} ${kind} ${variant}`;
  const en = await readAs(w, caller, entryId, 'en', version);
  const fr = await readAs(w, caller, entryId, 'fr', version);
  if (!en || !fr) {
    return [
      { property: '5 round trip (LOCCOPY)', detail: `${label}: the caller could not read both locales` },
    ];
  }
  const locale = variant === 'toFr' ? 'fr' : 'en';
  const own = wholeEcho(caller, variant === 'toFr' ? fr : en);
  // Through V a field read-only while the draft is ahead is refused (schema-lenses.md:318): the copy sends only
  // the title and the localized list.
  const sent: Json = {
    title: own.title,
    lchips: variant === 'toFr' ? [...chipsOf(fr), ...chipsOf(en)] : chipsOf(fr),
  };
  const heads = await headsOf(w, entryId);
  const draftOf = (at: string) => heads.find((head) => head.locale === at && head.state === 'draft');
  const publishedOf = (at: string) => heads.find((head) => head.locale === at && head.state === 'published');
  const strip = (data: Json | undefined) =>
    JSON.stringify(
      ((data?.[w.doc.lchips] as Json[] | undefined) ?? []).map((chip) => ({ ...chip, __id: undefined })),
    );
  const ahead = strip(draftOf(locale)?.data) !== strip(publishedOf(locale)?.data);
  const adminKind = caller.kind === 'admin' || caller.kind === 'adminToken' || caller.kind === 'pinned';
  const seesDraft = adminKind || !ahead;
  const otherBefore = draftOf(locale === 'fr' ? 'en' : 'fr')?.data;
  const response = await send(w, {
    caller,
    transport: caller.kind === 'admin' ? 'adminApi' : 'rest',
    entryId,
    locale,
    version,
    expectedVersion: draftOf(locale)?.version ?? null,
    body: sent,
  });
  const problems: Problem[] = [];
  if (response.status >= 300) {
    const issues = issuesOf(response.body);
    const allowed =
      !seesDraft &&
      response.status === 422 &&
      issues.length > 0 &&
      issues.every((issue) => issue.code === 'AMBIGUOUS_ITEMS' && issue.path === '/lchips');
    if (!allowed) {
      problems.push({
        property: '5 round trip (LOCCOPY)',
        detail: `${label}: copying items between locales answered ${response.status} ${issues.map((issue) => `${issue.code} ${issue.path}`).join(', ') || response.raw.slice(0, 200)}`,
      });
    }
    return problems;
  }
  const after = await headsOf(w, entryId);
  const draft = after.find((head) => head.locale === locale && head.state === 'draft');
  const visible = (chips: Json[]) => chips.map((chip) => chip.zv);
  const stored = ((draft?.data[w.doc.lchips] as Json[] | undefined) ?? []).map((chip) => chip[w.chip.zv]);
  if (!isDeepStrictEqual(stored, visible(sent.lchips as Json[]))) {
    problems.push({
      property: '1 conservation (LOCCOPY)',
      detail: `${label}: sent ${JSON.stringify(visible(sent.lchips as Json[]))}, stored ${JSON.stringify(stored)}`,
    });
  }
  problems.push(
    ...idUniqueness(draft ? [draft] : []).map((problem) => ({
      ...problem,
      detail: `${label}: ${problem.detail}`,
    })),
  );
  const other = after.find(
    (head) => head.locale === (locale === 'fr' ? 'en' : 'fr') && head.state === 'draft',
  );
  if (!isDeepStrictEqual(other?.data[w.doc.lchips], otherBefore?.[w.doc.lchips])) {
    problems.push({
      property: '1 conservation (LOCCOPY)',
      detail: `${label}: writing ${locale} changed the other locale's list`,
    });
  }
  return problems;
};
