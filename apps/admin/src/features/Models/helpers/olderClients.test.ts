import type {
  FieldConsumers,
  LensEffect,
  OlderClientField,
  OlderClients,
  OlderClientVersion,
} from '@shapio/client';
import { describe, expect, it } from 'vitest';
import {
  changeOlderClientsEffect,
  olderClientsEffectsByChange,
  olderReaderRows,
  readerOutcome,
  readerPastLoss,
  versionProtection,
  worstEffect,
} from './olderClients';

const SITE = { id: 's1', key: 'main' };

/** A field whose effect is all the proposal's, unless `past` says what it already reads. */
const field = (
  fieldId: string,
  effect: LensEffect,
  past: { pastEffect: LensEffect; pastSince: number | null; proposedEffect?: LensEffect } = {
    pastEffect: 'transparent',
    pastSince: null,
  },
): OlderClientField => ({
  fieldId,
  apiKey: fieldId,
  effect,
  proposedEffect: past.proposedEffect ?? effect,
  pastEffect: past.pastEffect,
  pastSince: past.pastSince,
});
const MODEL = 'm1';

const version = (
  schemaVersion: number,
  fields: OlderClientVersion['definitions'][number]['fields'],
  patch: Partial<OlderClientVersion> = {},
): OlderClientVersion => ({
  schemaVersion,
  readers: [
    {
      site: SITE,
      principalKey: `token:t${schemaVersion}`,
      label: `Site ${schemaVersion}`,
      pinned: false,
      network: false,
      lastReadAt: '',
    },
  ],
  readerCount: 1,
  otherSites: null,
  definitions: [
    {
      definitionId: MODEL,
      apiKey: 'article',
      status: 'available',
      effect: worstEffect(fields.map((field) => field.effect)),
      oldestVersion: null,
      fields,
      historyTruncated: false,
    },
  ],
  ...patch,
});

const v40 = version(40, [field('count', 'lossy'), field('body', 'nulled')]);
const v42 = version(42, [field('count', 'converted')]);
const older: OlderClients = { versions: [v42, v40], truncated: false };

describe('older clients', () => {
  it('ranks effects from keeps working to not covered', () => {
    expect(worstEffect([])).toBe('transparent');
    expect(worstEffect(['converted', 'nulled', 'lossy'])).toBe('nulled');
    expect(worstEffect(['gone', 'uncovered'])).toBe('uncovered');
  });

  it('takes a field change from the versions readers send, else from the change itself', () => {
    expect(changeOlderClientsEffect({ fieldId: 'count' }, 'lossy', MODEL, older)).toBe('lossy');
    expect(
      changeOlderClientsEffect({ fieldId: 'body' }, 'nulled', MODEL, { versions: [v42], truncated: false }),
    ).toBe('transparent');
    expect(changeOlderClientsEffect({ fieldId: 'count' }, 'lossy', MODEL, null)).toBe('lossy');
    // A definition-level change has no field to look up.
    expect(changeOlderClientsEffect({}, 'gone', MODEL, older)).toBe('gone');
    expect(changeOlderClientsEffect({ fieldId: 'count' }, 'lossy', 'other', older)).toBe('lossy');
  });

  it('gives a line only to breaking or destructive changes', () => {
    const rename = { kind: 'field.apiKey', fieldId: 'title', breaking: true, destructive: false } as const;
    const label = { kind: 'field.metadata', fieldId: 'title', breaking: false, destructive: false } as const;
    const effects = olderClientsEffectsByChange(
      [rename, label] as never,
      ['transparent', 'transparent'],
      MODEL,
      null,
    );
    expect([...effects.values()]).toEqual(['transparent', null]);
  });

  it('says what a reader sees for the fields it reads', () => {
    expect(readerOutcome(v40, new Set(['count']))).toBe('lossy');
    expect(readerOutcome(v40, new Set(['title']))).toBe('transparent');
    expect(readerOutcome(v40, null)).toBe('nulled');
    const gone = version(39, [], {
      definitions: [{ ...v40.definitions[0]!, effect: 'gone', fields: [] }],
    });
    expect(readerOutcome(gone, new Set(['title']))).toBe('gone');
    const unavailable = version(10, [], {
      definitions: [
        { ...v40.definitions[0]!, status: 'unavailable', effect: null, oldestVersion: 12, fields: [] },
      ],
    });
    expect(readerOutcome(unavailable, null)).toBe('unavailable');
  });

  it('splits versions into protected (keep working, converted) and not', () => {
    expect(versionProtection(older)).toEqual({ protectedVersions: [42], unprotectedVersions: [40] });
    expect(versionProtection(null)).toEqual({ protectedVersions: [], unprotectedVersions: [] });
  });

  it('lists named readers with their fields, and counts for the rest', () => {
    const consumers: FieldConsumers[] = [
      {
        modelId: MODEL,
        fieldId: 'count',
        apiKey: 'count',
        consumers: [
          {
            site: SITE,
            principalKey: 'token:t40',
            label: 'Site 40',
            reads: 3,
            lastReadAt: null,
            selection: 'explicit',
          },
        ],
        otherSites: null,
      },
    ];
    const hidden = version(41, v40.definitions[0]!.fields, {
      readers: null,
      readerCount: 2,
      otherSites: { consumers: 1 },
    });
    const rows = olderReaderRows({ versions: [v40, hidden], truncated: false }, consumers);
    expect(
      rows.map((row) => [
        row.schemaVersion,
        row.reader?.label ?? null,
        row.count,
        row.otherSites,
        row.outcome,
      ]),
    ).toEqual([
      [40, 'Site 40', 1, false, 'lossy'],
      [41, null, 2, false, 'nulled'],
      [41, null, 1, true, 'nulled'],
    ]);
  });

  it('keeps a breaking line about the proposed change: past loss is not blamed on it', () => {
    // A list an earlier change cut to its first item (since 37); the proposal only renames it.
    const cut = version(36, [
      field('links', 'lossy', { pastEffect: 'lossy', pastSince: 37, proposedEffect: 'transparent' }),
    ]);
    const older36: OlderClients = { versions: [cut], truncated: false };
    expect(changeOlderClientsEffect({ fieldId: 'links' }, 'transparent', MODEL, older36)).toBe('unchanged');
    // The proposal makes it worse: that is its doing.
    const worse = version(36, [
      field('links', 'nulled', { pastEffect: 'lossy', pastSince: 37, proposedEffect: 'nulled' }),
    ]);
    expect(
      changeOlderClientsEffect({ fieldId: 'links' }, 'nulled', MODEL, {
        versions: [worse],
        truncated: false,
      }),
    ).toBe('nulled');
    // The Consumers tab dates the past loss instead.
    expect(readerPastLoss(cut, new Set(['links']))).toEqual({ effect: 'lossy', since: 37 });
    expect(readerPastLoss(cut, new Set(['title']))).toBeNull();
    expect(olderReaderRows(older36, [])[0]?.pastLoss).toEqual({ effect: 'lossy', since: 37 });
  });
});
