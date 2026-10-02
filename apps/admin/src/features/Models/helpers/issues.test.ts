import type { ModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { issuesUnder, validateDraft } from './issues';

const ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ID = '00000000-0000-4000-8000-000000000002';
const FIELD_ID = '00000000-0000-4000-8000-000000000003';

const model = (overrides: Partial<ModelDefinition> = {}): ModelDefinition => ({
  id: ID,
  kind: 'collection',
  apiKey: 'article',
  label: 'Article',
  localized: false,
  draftAndPublish: true,
  fields: [],
  display: {},
  ...overrides,
});

const titleField = (apiKey: string) => ({
  id: FIELD_ID,
  apiKey,
  label: 'Title',
  type: 'string' as const,
  required: false,
  localized: false,
  public: true,
  unique: false,
  filterable: false,
  sortable: false,
  deprecated: false,
  settings: {},
  editor: { id: 'textInput', options: {} },
});

describe('validateDraft', () => {
  it('accepts a valid draft', () => {
    const draft = model({ fields: [titleField('title')] });
    expect(validateDraft(draft, model(), [])).toEqual([]);
  });

  it('reports field API key problems at the field path', () => {
    const draft = model({ fields: [titleField('1title')] });
    const issues = validateDraft(draft, model(), []);
    expect(issuesUnder(issues, '/fields/0').map((found) => found.code)).toEqual(['API_KEY_INVALID']);
  });

  it('reports collisions with other definitions on the draft', () => {
    const other = model({ id: OTHER_ID, apiKey: 'post', label: 'Post' });
    const draft = model({ apiKey: 'Post' });
    const issues = validateDraft(draft, model(), [other]);
    expect(issues.map((found) => [found.path, found.code])).toContainEqual(['/apiKey', 'API_KEY_COLLISION']);
  });

  it('reports a relation to an unknown model', () => {
    const relation = {
      ...titleField('author'),
      type: 'relation' as const,
      settings: { target: OTHER_ID, cardinality: 'one' as const },
      editor: { id: 'relationPicker', options: {} },
    };
    const issues = validateDraft(model({ fields: [relation] }), model(), []);
    expect(issuesUnder(issues, '/fields/0/settings').length).toBeGreaterThan(0);
  });
});

describe('issuesUnder', () => {
  it('matches the path and its descendants only', () => {
    const issues = [
      { path: '/fields/1', code: 'INVALID_ID' as const, message: '' },
      { path: '/fields/1/apiKey', code: 'API_KEY_INVALID' as const, message: '' },
      { path: '/fields/10/apiKey', code: 'API_KEY_INVALID' as const, message: '' },
    ];
    expect(issuesUnder(issues, '/fields/1')).toHaveLength(2);
  });
});
