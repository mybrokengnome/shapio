import { describe, expect, it } from 'vitest';
import { definitionApiKey, fieldApiKey, toCamelCase, toSlug, uniqueSlug } from './naming.js';

describe('import naming', () => {
  it('camel-cases source names into API IDs', () => {
    expect(toCamelCase('blog-post')).toBe('blogPost');
    expect(toCamelCase('Blog post')).toBe('blogPost');
    expect(toCamelCase('seo_meta')).toBe('seoMeta');
    expect(toCamelCase('seoMeta')).toBe('seoMeta');
    expect(toCamelCase('3d-model')).toBe('n3dModel');
    expect(toCamelCase('---')).toBe('item');
  });

  it('avoids reserved and repeated API IDs', () => {
    const taken = new Set<string>();
    expect(fieldApiKey('status', taken)).toBe('statusField');
    expect(fieldApiKey('title', taken)).toBe('title');
    expect(fieldApiKey('Title', taken)).toBe('title2');
    expect(definitionApiKey('new', new Set())).toBe('newItem');
    expect(definitionApiKey('query', new Set())).toBe('queryItem');
  });

  it('slugifies text and percent-encoded WordPress slugs', () => {
    expect(toSlug('Héllo, World!')).toBe('hello-world');
    expect(toSlug('caf%c3%a9-time')).toBe('cafe-time');
    expect(toSlug('100%')).toBe('100');
    const taken = new Set<string>();
    expect(uniqueSlug('Hello', 'post-1', taken)).toBe('hello');
    expect(uniqueSlug('hello', 'post-2', taken)).toBe('hello-2');
    expect(uniqueSlug('中文', 'post-3', taken)).toBe('post-3');
  });
});
