import { describe, expect, it } from 'vitest';
import type { StrapiSchema } from './exportFiles.js';
import { planStrapiSchema } from './schema.js';

const component = (uid: string): StrapiSchema => ({
  uid,
  modelType: 'component',
  category: uid.split('.')[0],
  info: { displayName: uid },
  attributes: { title: { type: 'string' } },
});

describe('planStrapiSchema', () => {
  it('lists content types and components whose API ID is not their Strapi name', () => {
    // Strapi's example project has `shared.media` and `shared.rich-text`: reserved names in Shapio.
    const { plans, notes } = planStrapiSchema([
      {
        uid: 'api::media.media',
        modelType: 'contentType',
        kind: 'collectionType',
        info: { singularName: 'media', pluralName: 'medias', displayName: 'Media' },
        attributes: { title: { type: 'string' } },
      },
      component('shared.media'),
      component('shared.rich-text'),
      component('shared.quote'),
    ]);

    expect([...plans.values()].map((plan) => plan.definition.apiKey)).toEqual([
      'mediaItem',
      'mediaItem2',
      'richTextItem',
      'quote',
    ]);
    expect(notes).toEqual([
      'api::media.media is named mediaItem (the name is reserved or already taken).',
      'shared.media is named mediaItem2 (the name is reserved or already taken).',
      'shared.rich-text is named richTextItem (the name is reserved or already taken).',
    ]);
  });
});
