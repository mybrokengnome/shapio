import type { FieldConsumers, OlderClients, OlderClientVersion } from '@shapio/client';
import { describe, expect, it } from 'vitest';
import {
  changeOlderClientsEffect,
  olderClientsEffectsByChange,
  olderReaderRows,
  readerOutcome,
  versionProtection,
  worstEffect,
} from './olderClients';

const SITE = { id: 's1', key: 'main' };
const MODEL = 'm1';

const version = (
  schemaVersion: number,
  fields: OlderClientVersion['definitions'][number]['fields'],
  patch: Partial<OlderClientVersion> = {},
): OlderClientVersion => ({
  schemaVersion,
  readers: [
    { site: SITE, principalKey: `token:t${schemaVersion}`, label: `Site ${schemaVersion}`, lastReadAt: '' },
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
    },
  ],
  ...patch,
});

const v40 = version(40, [
  { fieldId: 'count', apiKey: 'count', effect: 'lossy' },
  { fieldId: 'body', apiKey: 'body', effect: 'nulled' },
]);
const v42 = version(42, [{ fieldId: 'count', apiKey: 'count', effect: 'converted' }]);
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
});
