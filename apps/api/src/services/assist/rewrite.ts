import { completeText } from '../../assist/completion.js';
import { rewritePrompt } from '../../assist/prompts/rewrite.js';
import type { AssistServiceContext } from './context.js';
import { runAssist } from './runs.js';
import { cleanModelText, fitToLength } from './text.js';

export type RewriteInput = { text: string; instruction: string; maxLength?: number | undefined };
export type RewriteResult = { text: string; truncated: boolean; model: string };

/** A selection rewritten by an instruction. The text comes from the caller: no model permission applies. */
export const rewriteText = (context: AssistServiceContext, input: RewriteInput): Promise<RewriteResult> =>
  runAssist(
    context,
    {
      action: 'rewrite',
      metadata: { textLength: input.text.length, instructionLength: input.instruction.length },
    },
    async (meter) => {
      const prompt = rewritePrompt({
        instruction: input.instruction,
        text: input.text,
        maxLength: input.maxLength,
      });
      const text = await completeText(context.assist.provider, meter, {
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        ...(context.signal ? { signal: context.signal } : {}),
      });
      return { ...fitToLength(cleanModelText(text), input.maxLength), model: meter.model };
    },
  );
