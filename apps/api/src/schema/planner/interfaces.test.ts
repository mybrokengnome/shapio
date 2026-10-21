import { normalizeDefinition, type SchemaDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { buildChangePlan } from './plan.js';
import { leavingModels, relationValueIssues } from './relationValues.js';
import { findValueLocations } from './steps.js';

/** The planner with interfaces (plan interfaces, D9 and decision 9). */

const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const define = (input: Record<string, unknown>): SchemaDefinition =>
  normalizeDefinition({ kind: 'collection', label: String(input.apiKey), fields: [], ...input } as never);
const shared = (definitions: readonly SchemaDefinition[]) =>
  definitions.map((definition) => ({ definition, siteId: null }));

const title = (n: number) => ({
  id: id(n),
  apiKey: 'title',
  label: 'Title',
  type: 'string',
  filterable: true,
});

const featurable = define({
  id: id(1),
  kind: 'interface',
  apiKey: 'featurable',
  fields: [title(11)],
});
const post = define({ id: id(2), apiKey: 'post', implements: [id(1)], fields: [title(21)] });
const guide = define({ id: id(3), apiKey: 'guide', extends: id(2) });
const roadmap = define({ id: id(4), apiKey: 'roadmapItem', implements: [id(1)], fields: [title(41)] });
const relation = (n: number, apiKey: string, target: string) => ({
  id: id(n),
  apiKey,
  label: apiKey,
  type: 'relation',
  settings: { target, cardinality: 'many' },
});
const homepage = define({
  id: id(5),
  kind: 'singleton',
  apiKey: 'homepage',
  fields: [relation(51, 'featured', id(1)), relation(52, 'spotlight', '*'), relation(53, 'post', id(2))],
});
const schema = [featurable, post, guide, roadmap, homepage];

const plan = (before: SchemaDefinition | null, after: SchemaDefinition | null) =>
  buildChangePlan({
    before,
    after,
    fromVersion: before ? 1 : null,
    active: shared(schema),
    siteId: null,
    hasContent: before !== null,
  });

describe('planning an interface', () => {
  it('a contract change has no content or index work and affects every member, kinds included', () => {
    const after = define({
      ...featurable,
      fields: [...featurable.fields, { id: id(12), apiKey: 'summary', label: 's', type: 'text' }],
    });
    const result = plan(featurable, after);
    expect(result.prerequisites).toEqual([]);
    expect(result.followUps).toEqual([]);
    expect(result.affectedModelIds.sort()).toEqual([post.id, guide.id, roadmap.id].sort());
    // Every member lacks the field: validation names each.
    expect(result.issues.map((found) => [found.code, found.definitionId])).toEqual(
      expect.arrayContaining([
        ['INTERFACE_FIELD_MISSING', post.id],
        ['INTERFACE_FIELD_MISSING', roadmap.id],
      ]),
    );
  });

  it('an interface stores nothing: no value locations', () => {
    expect(findValueLocations(schema, featurable.id)).toEqual([]);
  });

  it('deleting an interface with members or relations to it is refused', () => {
    const codes = plan(featurable, null).issues.map((found) => found.code);
    expect(codes).toContain('HAS_MEMBERS');
    expect(codes).toContain('REFERENCED_DEFINITION');
  });

  it('implements added is a non-breaking contract change; removed is breaking', () => {
    const plain = define({ id: id(6), apiKey: 'note', fields: [title(61)] });
    const joined = define({ ...plain, implements: [featurable.id] });
    const active = shared([...schema, plain]);
    const added = buildChangePlan({
      before: plain,
      after: joined,
      fromVersion: 1,
      active,
      siteId: null,
      hasContent: true,
    });
    expect(added.changes).toMatchObject([
      { kind: 'model.implements', category: 'contract', breaking: false },
    ]);
    const removed = buildChangePlan({
      before: joined,
      after: plain,
      fromVersion: 1,
      active: shared([...schema, joined]),
      siteId: null,
      hasContent: true,
    });
    expect(removed.changes).toMatchObject([
      { kind: 'model.implements', category: 'contract', breaking: true },
    ]);
    expect(removed.summary.destructive).toBe(false);
  });

  it('widening a relation target keeps its values; narrowing clears them', () => {
    const widen = (target: string) =>
      plan(
        homepage,
        define({
          ...homepage,
          fields: homepage.fields.map((field) =>
            field.id === id(53) ? { ...field, settings: { ...field.settings, target } } : field,
          ),
        }),
      );
    for (const target of [featurable.id, '*']) {
      const result = widen(target);
      expect(result.changes).toMatchObject([{ category: 'contract', breaking: true, dropsValues: false }]);
      expect(result.prerequisites).toEqual([]);
    }
    const narrowed = plan(
      homepage,
      define({
        ...homepage,
        fields: homepage.fields.map((field) =>
          field.id === id(51) ? { ...field, settings: { ...field.settings, target: post.id } } : field,
        ),
      }),
    );
    expect(narrowed.changes).toMatchObject([{ category: 'conversion', destructive: true }]);
    expect(narrowed.prerequisites.map((step) => step.kind)).toEqual(['convert']);
  });
});

describe('relation values a change strands', () => {
  const without = (gone: string) => schema.filter((definition) => definition.id !== gone);
  const replaced = (definition: SchemaDefinition) =>
    schema.map((candidate) => (candidate.id === definition.id ? definition : candidate));

  it('a type that stops implementing an interface leaves relations to the interface', () => {
    const left = define({ ...roadmap, implements: [] });
    expect(leavingModels(schema, replaced(left))).toEqual([
      { target: featurable.id, modelId: roadmap.id, fields: [expect.objectContaining({ owner: homepage })] },
    ]);
  });

  it('a deleted member leaves its interface and any entry; a deleted kind leaves its parent', () => {
    expect(leavingModels(schema, without(roadmap.id)).map((found) => [found.target, found.modelId])).toEqual([
      [featurable.id, roadmap.id],
      ['*', roadmap.id],
    ]);
    expect(leavingModels(schema, without(guide.id)).map((found) => [found.target, found.modelId])).toEqual([
      [featurable.id, guide.id],
      ['*', guide.id],
      [post.id, guide.id],
    ]);
  });

  it('a relation whose own target changes is the classifier’s, not a stranded value', () => {
    const retargeted = define({
      ...homepage,
      fields: homepage.fields
        .filter((field) => field.id === id(51))
        .map((field) => ({
          ...field,
          settings: { ...field.settings, target: post.id },
        })),
    });
    expect(leavingModels(schema, replaced(retargeted))).toEqual([]);
  });

  it('reports a count per leaving model, naming the relations', async () => {
    const issues = await relationValueIssues(schema, without(roadmap.id), async ({ fieldIds }) =>
      fieldIds.includes(id(51)) ? 3 : 0,
    );
    expect(issues).toEqual([
      {
        path: '',
        code: 'RELATION_VALUES_EXIST',
        definitionId: roadmap.id,
        message:
          '3 entries still relate to "roadmapItem" entries through "homepage.featured" (a relation to "featurable"), which would no longer accept them; remove those references first',
      },
    ]);
  });
});
