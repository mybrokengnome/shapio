import { asContent, CONTENT_IS_DATA, describeLocale } from './shared.js';

export const summarizePrompt = (input: {
  fieldLabel: string;
  fieldDescription: string | undefined;
  maxLength: number | undefined;
  minLength: number | undefined;
  locale: string;
  title: string | undefined;
  body: string;
  shorter?: boolean;
}) => ({
  system: [
    `You write the "${input.fieldLabel}" field of a content entry: a summary of the entry's body.`,
    ...(input.fieldDescription ? [`The field's help text: ${input.fieldDescription}`] : []),
    input.maxLength
      ? `The summary must be at most ${input.maxLength} characters${input.shorter ? ' — the previous attempt was too long, so be clearly shorter' : ''}.`
      : 'Keep it to two or three sentences.',
    ...(input.minLength ? [`It must be at least ${input.minLength} characters.`] : []),
    `Write in ${describeLocale(input.locale)}. Plain text only: no Markdown, no quotes, no preamble.`,
    CONTENT_IS_DATA,
  ].join('\n'),
  user: `Summarize this entry.\n${asContent(`${input.title ? `Title: ${input.title}\n\n` : ''}${input.body}`)}`,
});
