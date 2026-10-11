import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildPolicy, combineRowReadMasks, unionMasks, type Grant, type ModelField } from './policy.js';
import type { FieldMask } from './types.js';

const MODEL = 'model-profile';
const FIELDS: readonly ModelField[] = [
  { id: 'f-name', public: true },
  { id: 'f-bio', public: true },
  { id: 'f-email', public: false },
];

const grant = (overrides: Partial<Grant> & Pick<Grant, 'action'>): Grant => ({
  roleId: 'r',
  modelId: null,
  condition: null,
  fieldIds: null,
  ...overrides,
});

const read = { action: 'read', modelId: MODEL } as const;

describe('read masks per row (issue #75)', () => {
  it('keeps a field granted only on own rows off every other row', () => {
    const policy = buildPolicy(
      [
        grant({ action: 'read', fieldIds: ['f-name'] }),
        grant({ action: 'read', condition: 'ownedByPrincipal', fieldIds: ['f-name', 'f-email'] }),
      ],
      read,
      'delivery',
      FIELDS,
    );
    expect(policy.rowFilter).toBeNull();
    // The union stays the shape of what the caller can see.
    expect(policy.readMask).toEqual({ mode: 'only', fieldIds: ['f-name', 'f-email'] });
    expect(policy.rowReadMasks).toEqual({
      everyRow: { mode: 'only', fieldIds: ['f-name'] },
      when: [
        { condition: { kind: 'ownedByPrincipal' }, mask: { mode: 'only', fieldIds: ['f-name', 'f-email'] } },
      ],
    });
  });

  it('needs no per-row masks when every readable row is the caller’s own', () => {
    expect(
      combineRowReadMasks(
        [grant({ action: 'read', condition: 'ownedByPrincipal', fieldIds: ['f-name', 'f-email'] })],
        'delivery',
        FIELDS,
      ),
    ).toBeNull();
  });

  it('needs no per-row masks when the own-rows grant adds nothing', () => {
    expect(
      combineRowReadMasks(
        [
          grant({ action: 'read' }),
          grant({ action: 'read', condition: 'ownedByPrincipal', fieldIds: ['f-name'] }),
        ],
        'delivery',
        FIELDS,
      ),
    ).toBeNull();
    expect(
      combineRowReadMasks(
        [grant({ action: 'read' }), grant({ action: 'read', condition: 'ownedByPrincipal' })],
        'admin',
        FIELDS,
      ),
    ).toBeNull();
  });

  it('applies to admin audiences too', () => {
    expect(
      combineRowReadMasks(
        [
          grant({ action: 'read', fieldIds: ['f-name'] }),
          grant({ action: 'read', condition: 'ownedByPrincipal' }),
        ],
        'admin',
        FIELDS,
      ),
    ).toEqual({
      everyRow: { mode: 'only', fieldIds: ['f-name'] },
      when: [{ condition: { kind: 'ownedByPrincipal' }, mask: { mode: 'all' } }],
    });
  });

  it('builds per-row masks from read grants for every action', () => {
    const policy = buildPolicy(
      [
        grant({ action: 'read', fieldIds: ['f-name'] }),
        grant({ action: 'read', condition: 'ownedByPrincipal', fieldIds: ['f-email'] }),
        grant({ action: 'update', condition: 'ownedByPrincipal', fieldIds: ['f-name'] }),
      ],
      { action: 'update', modelId: MODEL },
      'delivery',
      FIELDS,
    );
    expect(policy.rowFilter).toEqual({ kind: 'ownedByPrincipal' });
    expect(policy.rowReadMasks?.everyRow).toEqual({ mode: 'only', fieldIds: ['f-name'] });
  });

  it('never shows more on any row than the union, and never less than the every-row mask', () => {
    const fieldIds = fc.option(fc.subarray(FIELDS.map((field) => field.id)), { nil: null });
    const grants = fc.array(
      fc.record({
        condition: fc.constantFrom(null, 'ownedByPrincipal' as const),
        fieldIds,
      }),
      { minLength: 1, maxLength: 4 },
    );
    const ids = (mask: FieldMask) => (mask.mode === 'all' ? FIELDS.map((field) => field.id) : mask.fieldIds);
    fc.assert(
      fc.property(grants, fc.constantFrom('admin' as const, 'delivery' as const), (specs, audience) => {
        const policy = buildPolicy(
          specs.map((spec) => grant({ action: 'read', ...spec })),
          read,
          audience,
          FIELDS,
        );
        if (!policy.rowReadMasks) {
          return;
        }
        const own = policy.rowReadMasks.when.reduce(
          (mask, extra) => unionMasks(mask, extra.mask),
          policy.rowReadMasks.everyRow,
        );
        expect(new Set(ids(own))).toEqual(new Set(ids(policy.readMask)));
        // Any unconditioned grant: the every-row mask is exactly what those grants allow.
        if (specs.some((spec) => spec.condition === null)) {
          const unconditioned = buildPolicy(
            specs.filter((spec) => spec.condition === null).map((spec) => grant({ action: 'read', ...spec })),
            read,
            audience,
            FIELDS,
          );
          expect(new Set(ids(policy.rowReadMasks.everyRow))).toEqual(new Set(ids(unconditioned.readMask)));
        }
      }),
    );
  });
});
