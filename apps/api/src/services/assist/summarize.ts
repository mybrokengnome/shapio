import {
  effectiveLayout,
  richTextToPlainText,
  type FieldDefinition,
  type ModelDefinition,
  type RichTextDocument,
} from '@shapio/schema';
import { completeText } from '../../assist/completion.js';
import { summarizePrompt } from '../../assist/prompts/summarize.js';
import { ASSIST_SUMMARY_SOURCE_CHARS } from '../../constants/assist.js';
import { maskAllows } from '../../content/compiler/policy.js';
import { writeLocaleFor } from '../../content/locales.js';
import { AppError } from '../../helpers/appError.js';
import { modelWithPolicy } from '../contentAccess.js';
import type { AssistServiceContext } from './context.js';
import { loadEntryDraft } from './entrySource.js';
import { runAssist } from './runs.js';
import { cleanModelText, fitToLength } from './text.js';

export type SummarizeInput = {
  modelKey: string;
  entryId: string;
  locale?: string | undefined;
  fieldApiKey: string;
};
export type SummarizeResult = { text: string; truncated: boolean; model: string };

const notSummarizable = (fieldApiKey: string, reason: string) =>
  new AppError(
    400,
    'ASSIST_FIELD_NOT_SUMMARIZABLE',
    `"${fieldApiKey}" cannot be summarized into: ${reason}`,
    {
      field: fieldApiKey,
    },
  );

/**
 * The target must be a string or text property (not the title) of a model whose document has a rich-text
 * canvas field: the summary is made from that canvas (plan §I).
 */
const summaryTarget = (definition: ModelDefinition, fieldApiKey: string) => {
  const layout = effectiveLayout(definition);
  const field = layout.properties.find((candidate) => candidate.apiKey === fieldApiKey);
  if (!field) {
    throw layout.title?.apiKey === fieldApiKey
      ? notSummarizable(fieldApiKey, 'it is the title')
      : notSummarizable(fieldApiKey, 'it is not a property of this model');
  }
  if (field.type !== 'string' && field.type !== 'text') {
    throw notSummarizable(fieldApiKey, 'only string and text fields hold summaries');
  }
  const canvas = layout.canvas.filter((candidate) => candidate.type === 'richtext');
  if (canvas.length === 0) {
    throw notSummarizable(fieldApiKey, 'the model has no rich-text body to summarize');
  }
  return { field: field as FieldDefinition<'string' | 'text'>, canvas, title: layout.title };
};

const plainTextOf = (value: unknown): string =>
  typeof value === 'object' && value !== null && 'doc' in value
    ? richTextToPlainText(value as RichTextDocument)
    : '';

/** A summary of the entry's draft body for one property (`read` and `update` on the model). */
export const summarizeEntry = async (
  context: AssistServiceContext,
  input: SummarizeInput,
): Promise<SummarizeResult> => {
  const { model, policy: readPolicy } = await modelWithPolicy(context, input.modelKey, 'read');
  const { policy: updatePolicy } = await modelWithPolicy(context, input.modelKey, 'update');
  const target = summaryTarget(model.definition, input.fieldApiKey);
  if (!maskAllows(updatePolicy.writeMask, target.field)) {
    throw new AppError(403, 'FORBIDDEN', `Your role does not allow editing "${input.fieldApiKey}"`);
  }
  const locale = writeLocaleFor(context.snapshot, model.definition, input.locale);
  const { draft } = await loadEntryDraft(context, model, readPolicy, input.entryId, locale);
  const body = target.canvas
    .filter((field) => maskAllows(readPolicy.readMask, field))
    .map((field) => plainTextOf(draft.data[field.id]))
    .filter((text) => text.trim() !== '')
    .join('\n\n')
    .slice(0, ASSIST_SUMMARY_SOURCE_CHARS);
  if (body.trim() === '') {
    throw new AppError(422, 'ASSIST_NOTHING_TO_SUMMARIZE', 'The entry has no body text to summarize yet');
  }
  const titleValue =
    target.title && maskAllows(readPolicy.readMask, target.title) ? draft.data[target.title.id] : undefined;
  const { maxLength, minLength } = target.field.settings;
  return runAssist(
    context,
    {
      action: 'summarize',
      target: { type: 'entry', id: input.entryId },
      metadata: { modelKey: model.definition.apiKey, field: target.field.apiKey, locale: draft.locale },
    },
    async (meter) => {
      const ask = async (shorter: boolean) => {
        const prompt = summarizePrompt({
          fieldLabel: target.field.label,
          fieldDescription: target.field.description,
          maxLength,
          minLength,
          locale: draft.locale,
          title: typeof titleValue === 'string' ? titleValue : undefined,
          body,
          shorter,
        });
        return cleanModelText(
          await completeText(context.assist.provider, meter, {
            system: prompt.system,
            messages: [{ role: 'user', content: prompt.user }],
            ...(context.signal ? { signal: context.signal } : {}),
          }),
          { singleLine: target.field.type === 'string' },
        );
      };
      let text = await ask(false);
      if (maxLength !== undefined && [...text].length > maxLength) {
        text = await ask(true);
      }
      return { ...fitToLength(text, maxLength), model: meter.model };
    },
  );
};
