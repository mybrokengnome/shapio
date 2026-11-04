import { completeText } from '../../assist/completion.js';
import { assistInvalidOutput } from '../../assist/errors.js';
import { writePrompt, type WriteKind } from '../../assist/prompts/write.js';
import { AppError } from '../../helpers/appError.js';
import type { AssistServiceContext } from './context.js';
import { assertLocale } from './entrySource.js';
import { runAssist } from './runs.js';
import { unwrapFence } from './text.js';

export type WriteInput = {
  kind: WriteKind;
  /** Required for `section` (the schema checks it); an optional steer for `continue`. */
  instruction?: string | undefined;
  before: string;
  after?: string | undefined;
  title?: string | undefined;
  fieldLabel?: string | undefined;
  locale?: string | undefined;
};
export type WriteResult = { markdown: string; model: string };

/**
 * Text drafted into a document at the editor's cursor (plan write-and-fill §2). The context comes from the
 * caller, like rewrite: no entry is read and no model permission applies. Returns Markdown for review.
 */
export const writeText = (context: AssistServiceContext, input: WriteInput): Promise<WriteResult> => {
  if (input.locale !== undefined) {
    assertLocale(context, input.locale);
  }
  if (input.kind === 'continue' && input.before.trim() === '') {
    throw new AppError(422, 'ASSIST_NOTHING_TO_WORK_FROM', 'There is no text to continue yet');
  }
  return runAssist(
    context,
    {
      action: 'write',
      metadata: {
        kind: input.kind,
        beforeLength: input.before.length,
        afterLength: input.after?.length ?? 0,
        instructionLength: input.instruction?.length ?? 0,
        ...(input.locale ? { locale: input.locale } : {}),
      },
    },
    async (meter) => {
      const prompt = writePrompt({
        kind: input.kind,
        instruction: input.instruction,
        fieldLabel: input.fieldLabel,
        locale: input.locale,
        title: input.title,
        before: input.before,
        after: input.after,
      });
      const markdown = unwrapFence(
        await completeText(context.assist.provider, meter, {
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
          ...(context.signal ? { signal: context.signal } : {}),
        }),
      );
      if (markdown === '') {
        throw assistInvalidOutput('The model returned no text');
      }
      return { markdown, model: meter.model };
    },
  );
};
