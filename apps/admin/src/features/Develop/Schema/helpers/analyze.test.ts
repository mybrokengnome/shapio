import { serializeDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { analyzeFile, issuesOf } from './analyze';
import { ARTICLE, AUTHOR, SEO } from './testDefinitions';

const context = { previous: ARTICLE, others: [AUTHOR, SEO] };

describe('analyzeFile', () => {
  it('accepts a pulled file as it is', () => {
    const analysis = analyzeFile(serializeDefinition(ARTICLE), context);
    expect(analysis.status).toBe('valid');
  });

  it('reports a JSON syntax error without validator issues (the JSON linter places it)', () => {
    const analysis = analyzeFile('{ "id": ', context);
    expect(analysis.status).toBe('invalidJson');
    expect(issuesOf(analysis)).toEqual([]);
  });

  it('reports the server validators’ issues with JSON-pointer paths', () => {
    const edited = {
      ...ARTICLE,
      fields: ARTICLE.fields.map((field, index) => (index === 0 ? { ...field, apiKey: '1title' } : field)),
    };
    const issues = issuesOf(analyzeFile(JSON.stringify(edited), context));
    expect(issues.map((issue) => issue.path)).toContain('/fields/0/apiKey');
  });

  it('runs cross-definition checks against the other files', () => {
    const clash = { ...ARTICLE, apiKey: 'author' };
    const issues = issuesOf(analyzeFile(JSON.stringify(clash), context));
    expect(issues.some((issue) => issue.code === 'API_KEY_COLLISION')).toBe(true);
  });

  it('flags a relation to a definition that does not exist', () => {
    const issues = issuesOf(analyzeFile(serializeDefinition(ARTICLE), { previous: ARTICLE, others: [SEO] }));
    expect(issues.some((issue) => issue.code === 'UNKNOWN_REFERENCE')).toBe(true);
  });
});
