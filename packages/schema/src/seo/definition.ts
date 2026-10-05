import { normalizeDefinition } from '../normalize.js';
import type { ComponentDefinition } from '../types/definitions.js';
import { SEO_COMPONENT_API_KEY, SEO_COMPONENT_ID, SEO_FIELD_IDS } from './ids.js';

/**
 * The built-in SEO component as first created. All fields are public and none has a length limit: the 70 and
 * 160 character marks are admin-only counters (`SEO_TITLE_SOFT_MAX`), never validation.
 */
export const seoComponentDefinition = (): ComponentDefinition =>
  normalizeDefinition({
    id: SEO_COMPONENT_ID,
    kind: 'component',
    apiKey: SEO_COMPONENT_API_KEY,
    label: 'SEO',
    description: 'Search and social metadata: title, description, image, canonical URL and indexing.',
    category: 'Built-in',
    icon: 'search',
    fields: [
      { id: SEO_FIELD_IDS.title, apiKey: 'title', label: 'Title', type: 'string' },
      { id: SEO_FIELD_IDS.description, apiKey: 'description', label: 'Description', type: 'text' },
      {
        id: SEO_FIELD_IDS.image,
        apiKey: 'image',
        label: 'Social image',
        type: 'media',
        settings: { multiple: false, allowedKinds: ['image'] },
      },
      {
        id: SEO_FIELD_IDS.canonical,
        apiKey: 'canonical',
        label: 'Canonical URL',
        type: 'url',
        settings: { protocols: ['https', 'http'] },
      },
      { id: SEO_FIELD_IDS.noindex, apiKey: 'noindex', label: 'Hide from search engines', type: 'boolean' },
    ],
    display: { titleFieldId: SEO_FIELD_IDS.title },
  }) as ComponentDefinition;
