/**
 * `@shapio/schema/html`: HTML → rich text for importers. A separate entry so the main one stays free of the
 * HTML parser (the admin bundles `@shapio/schema`).
 */
export * from './richtext/fromHtml.js';
