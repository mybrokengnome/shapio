import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildPolicy, combineRowFieldMasks, unionMasks, type Grant, type ModelField } from './policy.js';
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
    expect(policy.readMask).toEqual({
      mode: 'only',
      fieldIds: ['f-name', 'f-email'],
      componentFields: 'public',
    });
    expect(policy.rowReadMasks).toEqual({
      everyRow: { mode: 'only', fieldIds: ['f-name'], componentFields: 'public' },
      when: [
        {
          condition: { kind: 'ownedByPrincipal' },
          mask: { mode: 'only', fieldIds: ['f-name', 'f-email'], componentFields: 'public' },
        },
      ],
    });
  });

  it('needs no per-row masks when every readable row is the caller’s own', () => {
    expect(
      combineRowFieldMasks(
        [grant({ action: 'read', condition: 'ownedByPrincipal', fieldIds: ['f-name', 'f-email'] })],
        'delivery',
        FIELDS,
      ),
    ).toBeNull();
  });

  it('needs no per-row masks when the own-rows grant adds nothing', () => {
    expect(
      combineRowFieldMasks(
        [
          grant({ action: 'read' }),
          grant({ action: 'read', condition: 'ownedByPrincipal', fieldIds: ['f-name'] }),
        ],
        'delivery',
        FIELDS,
      ),
    ).toBeNull();
    expect(
      combineRowFieldMasks(
        [grant({ action: 'read' }), grant({ action: 'read', condition: 'ownedByPrincipal' })],
        'admin',
        FIELDS,
      ),
    ).toBeNull();
  });

  it('applies to admin audiences too', () => {
    expect(
      combineRowFieldMasks(
        [
          grant({ action: 'read', fieldIds: ['f-name'] }),
          grant({ action: 'read', condition: 'ownedByPrincipal' }),
        ],
        'admin',
        FIELDS,
      ),
    ).toEqual({
      everyRow: { mode: 'only', fieldIds: ['f-name'], componentFields: 'all' },
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
    expect(policy.rowReadMasks?.everyRow).toEqual({
      mode: 'only',
      fieldIds: ['f-name'],
      componentFields: 'public',
    });
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

describe('write masks per row (issue #80)', () => {
  const update = { action: 'update', modelId: MODEL } as const;

  it('keeps a field granted for writing only on own rows off every other row', () => {
    // The issue's roles: update every row's `bio`; update own rows' `name`.
    const policy = buildPolicy(
      [
        grant({ roleId: 'a', action: 'update', fieldIds: ['f-bio'] }),
        grant({ roleId: 'b', action: 'update', condition: 'ownedByPrincipal', fieldIds: ['f-name'] }),
      ],
      update,
      'delivery',
      FIELDS,
    );
    expect(policy.rowFilter).toBeNull();
    // The union stays the shape of what the caller can send.
    expect(policy.writeMask).toEqual({
      mode: 'only',
      fieldIds: ['f-name', 'f-bio'],
      componentFields: 'public',
    });
    expect(policy.rowWriteMasks).toEqual({
      everyRow: { mode: 'only', fieldIds: ['f-bio'], componentFields: 'public' },
      when: [
        {
          condition: { kind: 'ownedByPrincipal' },
          mask: { mode: 'only', fieldIds: ['f-name'], componentFields: 'public' },
        },
      ],
    });
  });

  it('needs no per-row write masks for unconditioned roles, or own rows only', () => {
    expect(buildPolicy([grant({ action: 'update' })], update, 'admin', FIELDS).rowWriteMasks).toBeNull();
    expect(
      buildPolicy(
        [grant({ action: 'update', condition: 'ownedByPrincipal', fieldIds: ['f-name'] })],
        update,
        'delivery',
        FIELDS,
      ).rowWriteMasks,
    ).toBeNull();
  });

  it('builds per-row write masks from the create grants on create', () => {
    const policy = buildPolicy(
      [
        grant({ action: 'create', fieldIds: ['f-bio'] }),
        grant({ action: 'create', condition: 'ownedByPrincipal', fieldIds: ['f-name'] }),
        grant({ action: 'update', fieldIds: ['f-email'] }),
      ],
      { action: 'create', modelId: MODEL },
      'admin',
      FIELDS,
    );
    expect(policy.rowWriteMasks).toEqual({
      everyRow: { mode: 'only', fieldIds: ['f-bio'], componentFields: 'all' },
      when: [
        {
          condition: { kind: 'ownedByPrincipal' },
          mask: { mode: 'only', fieldIds: ['f-name'], componentFields: 'all' },
        },
      ],
    });
  });

  it('has no write masks for actions that do not write', () => {
    const policy = buildPolicy(
      [
        grant({ action: 'read', fieldIds: ['f-name'] }),
        grant({ action: 'read', condition: 'ownedByPrincipal' }),
      ],
      read,
      'admin',
      FIELDS,
    );
    expect(policy.writeMask).toEqual({ mode: 'only', fieldIds: [], componentFields: 'public' });
    expect(policy.rowWriteMasks).toBeNull();
  });

  it('never allows more on any row than the union, and never less than the every-row mask', () => {
    const fieldIds = fc.option(fc.subarray(FIELDS.map((field) => field.id)), { nil: null });
    const grants = fc.array(
      fc.record({ condition: fc.constantFrom(null, 'ownedByPrincipal' as const), fieldIds }),
      { minLength: 1, maxLength: 4 },
    );
    const ids = (mask: FieldMask) => (mask.mode === 'all' ? FIELDS.map((field) => field.id) : mask.fieldIds);
    fc.assert(
      fc.property(grants, fc.constantFrom('admin' as const, 'delivery' as const), (specs, audience) => {
        const policy = buildPolicy(
          specs.map((spec) => grant({ action: 'update', ...spec })),
          update,
          audience,
          FIELDS,
        );
        if (!policy.rowWriteMasks) {
          return;
        }
        const own = policy.rowWriteMasks.when.reduce(
          (mask, extra) => unionMasks(mask, extra.mask),
          policy.rowWriteMasks.everyRow,
        );
        expect(new Set(ids(own))).toEqual(new Set(ids(policy.writeMask)));
        for (const id of ids(policy.rowWriteMasks.everyRow)) {
          expect(ids(policy.writeMask)).toContain(id);
        }
        if (specs.some((spec) => spec.condition === null)) {
          const unconditioned = buildPolicy(
            specs
              .filter((spec) => spec.condition === null)
              .map((spec) => grant({ action: 'update', ...spec })),
            update,
            audience,
            FIELDS,
          );
          expect(new Set(ids(policy.rowWriteMasks.everyRow))).toEqual(new Set(ids(unconditioned.writeMask)));
        }
      }),
    );
  });
});
