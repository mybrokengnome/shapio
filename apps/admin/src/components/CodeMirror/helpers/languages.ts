import type { Extension } from '@codemirror/state';
import type { CodeLanguage } from '@shapio/schema';

/**
 * Language support per code language, each pack its own chunk: loaded only when an editor for that language
 * opens. HTML closes no tags on its own (no editor here inserts text the person did not type).
 */
const LOADERS: Readonly<Record<CodeLanguage, () => Promise<Extension>>> = {
  plain: () => Promise.resolve([]),
  html: () => import('@codemirror/lang-html').then(({ html }) => html({ autoCloseTags: false })),
  css: () => import('@codemirror/lang-css').then(({ css }) => css()),
  javascript: () => import('@codemirror/lang-javascript').then(({ javascript }) => javascript()),
  json: () => import('@codemirror/lang-json').then(({ json }) => json()),
  yaml: () => import('@codemirror/lang-yaml').then(({ yaml }) => yaml()),
  markdown: () => import('@codemirror/lang-markdown').then(({ markdown }) => markdown()),
};

export const languageExtension = (language: CodeLanguage): Promise<Extension> => LOADERS[language]();
