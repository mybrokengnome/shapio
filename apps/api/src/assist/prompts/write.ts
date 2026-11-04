import { asContent, CONTENT_IS_DATA, describeLocale } from './shared.js';

export type WriteKind = 'section' | 'continue';

/**
 * Text drafted into a rich-text document (plan write-and-fill §3). The instruction and the field come from the
 * signed-in editor (trusted); the title and the text around the insertion point are content (data). The answer
 * is Markdown limited to what the canvas stores. The opening words are matched by the admin's e2e fake model.
 */
export const writePrompt = (input: {
  kind: WriteKind;
  instruction: string | undefined;
  fieldLabel: string | undefined;
  locale: string | undefined;
  title: string | undefined;
  before: string;
  after: string | undefined;
}) => {
  const context = [
    ...(input.title ? [`Title: ${input.title}`] : []),
    `Text before the insertion point:\n${input.before.trim() === '' ? '(none: the document is empty here)' : input.before}`,
    ...(input.after?.trim() ? [`Text after the insertion point:\n${input.after}`] : []),
  ].join('\n\n');
  return {
    system: [
      "You draft text for a document in a website's content editor, to be inserted where the editor's cursor is.",
      ...(input.fieldLabel ? [`The document is the "${input.fieldLabel}" field of a content entry.`] : []),
      input.kind === 'section'
        ? `Write what the editor asked for: ${input.instruction ?? ''}`
        : 'Continue the text from where it stops, with one to three paragraphs that follow on naturally.',
      ...(input.kind === 'continue' && input.instruction
        ? [`The editor's direction: ${input.instruction}`]
        : []),
      input.locale
        ? `Write in ${describeLocale(input.locale)}.`
        : 'Write in the language of the surrounding text.',
      'Answer in Markdown using only ## and ### headings, paragraphs, bullet and numbered lists, block quotes,',
      '**bold**, *italic* and `inline code`. No images, tables, links, HTML or front matter.',
      'Do not repeat the text around the insertion point. Answer with the new text only: no preamble, no remarks.',
      CONTENT_IS_DATA,
    ].join('\n'),
    user: `${input.kind === 'section' ? 'Write the section' : 'Continue the text'} for this document.\n${asContent(context)}`,
  };
};
