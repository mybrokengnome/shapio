import { id } from './api';

/**
 * The brief's page (§6): a localized Page with a hero (component), a feature grid (repeatable component),
 * a gallery (media), rich text, a relation to an Author, sections (dynamic zone), and a rating edited by
 * the project's custom star editor. Title and hero/features/body/sections are per locale; slug, rating,
 * gallery and author are shared by every locale.
 */
export const HERO_ID = id();
export const FEATURE_ID = id();
export const AUTHOR_ID = id();

export const hero = {
  id: HERO_ID,
  kind: 'component',
  apiKey: 'hero',
  label: 'Hero',
  fields: [
    { id: id(), apiKey: 'heading', label: 'Heading', type: 'string' },
    { id: id(), apiKey: 'subheading', label: 'Subheading', type: 'text' },
    { id: id(), apiKey: 'image', label: 'Image', type: 'media', settings: { allowedKinds: ['image'] } },
  ],
};

const featureTitle = id();
export const feature = {
  id: FEATURE_ID,
  kind: 'component',
  apiKey: 'feature',
  label: 'Feature',
  display: { titleFieldId: featureTitle },
  fields: [
    { id: featureTitle, apiKey: 'title', label: 'Feature title', type: 'string' },
    { id: id(), apiKey: 'description', label: 'Description', type: 'text' },
  ],
};

const authorName = id();
export const author = {
  id: AUTHOR_ID,
  kind: 'collection',
  apiKey: 'author',
  label: 'Author',
  display: { titleFieldId: authorName },
  fields: [
    { id: authorName, apiKey: 'name', label: 'Name', type: 'string', required: true, filterable: true },
    { id: id(), apiKey: 'bio', label: 'Bio', type: 'text' },
  ],
};

const title = id();
const slug = id();
const rating = id();
export const page = {
  id: id(),
  kind: 'collection',
  apiKey: 'page',
  label: 'Page',
  localized: true,
  display: { titleFieldId: title, listFieldIds: [title, slug, rating] },
  fields: [
    {
      id: title,
      apiKey: 'title',
      label: 'Title',
      type: 'string',
      localized: true,
      filterable: true,
      sortable: true,
    },
    { id: slug, apiKey: 'slug', label: 'Slug', type: 'slug', settings: { sourceFieldId: title } },
    {
      id: rating,
      apiKey: 'rating',
      label: 'Rating',
      type: 'integer',
      settings: { min: 1, max: 5 },
      // The custom editor offers 8 stars on purpose: the server still enforces the field's max of 5.
      editor: { id: 'acme.starRating', options: { stars: 8 } },
    },
    {
      id: id(),
      apiKey: 'hero',
      label: 'Hero',
      type: 'component',
      localized: true,
      settings: { component: HERO_ID },
    },
    {
      id: id(),
      apiKey: 'features',
      label: 'Feature grid',
      type: 'component',
      localized: true,
      settings: { component: FEATURE_ID, repeatable: true },
    },
    { id: id(), apiKey: 'gallery', label: 'Gallery', type: 'media', settings: { multiple: true } },
    { id: id(), apiKey: 'body', label: 'Body', type: 'richtext', localized: true },
    {
      id: id(),
      apiKey: 'author',
      label: 'Author',
      type: 'relation',
      settings: { target: AUTHOR_ID, cardinality: 'one' },
      editor: { id: 'relationPicker', options: { allowInlineCreate: true } },
    },
    {
      id: id(),
      apiKey: 'sections',
      label: 'Sections',
      type: 'dynamiczone',
      localized: true,
      settings: { components: [HERO_ID, FEATURE_ID] },
    },
  ],
};

const siteName = id();
export const siteSettings = {
  id: id(),
  kind: 'singleton',
  apiKey: 'siteSettings',
  label: 'Site settings',
  display: { titleFieldId: siteName },
  fields: [
    { id: siteName, apiKey: 'siteName', label: 'Site name', type: 'string' },
    {
      id: id(),
      apiKey: 'accent',
      label: 'Accent colour',
      type: 'string',
      editor: { id: 'color', options: {} },
    },
    { id: id(), apiKey: 'launch', label: 'Launch', type: 'datetime' },
    {
      id: id(),
      apiKey: 'tone',
      label: 'Tone',
      type: 'enum',
      settings: {
        values: [
          { value: 'calm', label: 'Calm' },
          { value: 'bold', label: 'Bold' },
        ],
      },
      editor: { id: 'segmented', options: {} },
    },
    { id: id(), apiKey: 'meta', label: 'Metadata', type: 'json' },
  ],
};
