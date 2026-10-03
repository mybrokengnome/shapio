import { asContent, CONTENT_IS_DATA } from './shared.js';

/** The instruction comes from the signed-in editor (trusted); the selection is content (data). */
export const rewritePrompt = (input: {
  instruction: string;
  text: string;
  maxLength: number | undefined;
}) => ({
  system: [
    "You rewrite a passage of website content following the editor's instruction.",
    `The editor's instruction: ${input.instruction}`,
    'Keep the language of the passage unless the instruction says otherwise. Keep facts, names and numbers.',
    ...(input.maxLength ? [`The result must be at most ${input.maxLength} characters.`] : []),
    'Answer with the rewritten passage only: no preamble, no quotes, no Markdown unless the passage uses it.',
    CONTENT_IS_DATA,
  ].join('\n'),
  user: `Rewrite this passage.\n${asContent(input.text)}`,
});
