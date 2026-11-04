import { completeJson, completeText, type UsageMeter } from '../../assist/completion.js';
import { assistInvalidOutput } from '../../assist/errors.js';
import { enumAnswerSchema, suggestPrompt, type SuggestPromptInput } from '../../assist/prompts/suggest.js';
import { maskAllows, rowReadMask, rowWriteMask } from '../../content/compiler/policy.js';
import { writeLocaleFor } from '../../content/locales.js';
import type { ContentModel } from '../../content/model.js';
import type { ContentData } from '../../db/contentData.js';
import { AppError } from '../../helpers/appError.js';
import type { FieldMask } from '../../permissions/types.js';
import { modelWithPolicy } from '../contentAccess.js';
import type { AssistServiceContext } from './context.js';
import { loadEntryDraft } from './entrySource.js';
import { entrySourceText } from './entryText.js';
import { runAssist } from './runs.js';
import { resolveSuggestTarget, type SuggestTarget } from './suggestTarget.js';
import { askWithinLength, cleanModelText } from './text.js';

export type SuggestInput = {
  modelKey: string;
  entryId: string;
  locale?: string | undefined;
  fieldPath: string;
};
/** A string, or for an enum what the field stores: one value, or a list when it allows several. */
export type SuggestedValue = string | string[];
export type SuggestResult = { value: SuggestedValue; truncated: boolean; model: string };

/** One draft and the field a value is suggested for, as resolved by the endpoint or a fill run. */
export type SuggestSubject = {
  model: ContentModel;
  target: SuggestTarget;
  data: Readonly<ContentData>;
  locale: string;
  /** What the caller may read on this entry (`rowReadMask`): only that is sent. */
  readMask: FieldMask;
};

export const nothingToWorkFrom = () =>
  new AppError(422, 'ASSIST_NOTHING_TO_WORK_FROM', 'The entry has no text to make a suggestion from yet');

const labelOf = (target: SuggestTarget) =>
  target.parent ? `${target.parent.field.label} › ${target.field.label}` : target.field.label;

const deduplicated = (values: readonly string[]) => [...new Set(values)];

/** The text the subject's suggestion is made from; 422 ASSIST_NOTHING_TO_WORK_FROM when there is none. */
export const subjectSource = (subject: SuggestSubject): string => {
  const source = entrySourceText(subject.model, subject.data, subject.readMask, {
    fieldId: subject.target.topField.id,
    ...(subject.target.parent ? { componentFieldId: subject.target.field.id } : {}),
  });
  if (source.trim() === '') {
    throw nothingToWorkFrom();
  }
  return source;
};

/**
 * A value for the subject's field, from the rest of its draft (plan write-and-fill §2): text with one shorter
 * retry and a cut at the field's maximum, or an enum answer checked against the allowed values. The model calls
 * count on `meter`. 422 ASSIST_NOTHING_TO_WORK_FROM when nothing readable holds text.
 */
export const suggestFieldValue = async (
  context: AssistServiceContext,
  meter: UsageMeter,
  subject: SuggestSubject,
): Promise<{ value: SuggestedValue; truncated: boolean }> => {
  const { target } = subject;
  const source = subjectSource(subject);
  const base = {
    modelLabel: subject.model.definition.label,
    fieldLabel: labelOf(target),
    fieldDescription: target.field.description,
    isTitle: target.isTitle,
    locale: subject.locale,
    source,
  };
  const signal = context.signal ? { signal: context.signal } : {};
  const field = target.field;
  if (field.type === 'enum') {
    const multiple = field.settings.multiple;
    const prompt = suggestPrompt({ ...base, type: 'enum', options: field.settings.values, multiple });
    const answer = await completeJson(context.assist.provider, meter, {
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      name: 'suggestion',
      schema: enumAnswerSchema(
        field.settings.values.map((option) => option.value),
        multiple,
      ),
      ...signal,
    });
    const value = 'values' in answer ? deduplicated(answer.values) : answer.value;
    return { value, truncated: false };
  }
  const { maxLength, minLength } = field.settings;
  const pattern = field.type === 'string' ? field.settings.pattern : undefined;
  const ask = async (shorter: boolean) => {
    const input: SuggestPromptInput = {
      ...base,
      type: field.type,
      maxLength,
      minLength,
      softMaxLength: target.softMaxLength,
      pattern,
      shorter,
    };
    const prompt = suggestPrompt(input);
    const text = cleanModelText(
      await completeText(context.assist.provider, meter, {
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        ...signal,
      }),
      { singleLine: field.type === 'string' },
    );
    if (text === '') {
      throw assistInvalidOutput('The model returned an empty value');
    }
    return text;
  };
  const fitted = await askWithinLength(ask, maxLength, maxLength ?? target.softMaxLength);
  return { value: fitted.text, truncated: fitted.truncated };
};

/**
 * A suggestion for one field of an entry's saved draft (`read` and `update` on the model, and the field writable
 * for the caller on this entry). Nothing is written: the editor reviews the value and saves it.
 */
export const suggestEntryValue = async (
  context: AssistServiceContext,
  input: SuggestInput,
): Promise<SuggestResult> => {
  const { model, policy: readPolicy } = await modelWithPolicy(context, input.modelKey, 'read');
  const { policy: updatePolicy } = await modelWithPolicy(context, input.modelKey, 'update');
  const target = resolveSuggestTarget(model, input.fieldPath);
  const locale = writeLocaleFor(context.snapshot, model.definition, input.locale);
  const { entry, draft } = await loadEntryDraft(context, model, readPolicy, input.entryId, locale);
  if (!maskAllows(rowWriteMask(updatePolicy, context.actor, entry), target.topField)) {
    throw new AppError(403, 'FORBIDDEN', `Your role does not allow editing "${input.fieldPath}"`);
  }
  const subject: SuggestSubject = {
    model,
    target,
    data: draft.data,
    locale: draft.locale,
    readMask: rowReadMask(readPolicy, context.actor, entry),
  };
  // Before the run: an entry with nothing to work from is not a model request.
  subjectSource(subject);
  return runAssist(
    context,
    {
      action: 'suggest',
      target: { type: 'entry', id: input.entryId },
      metadata: {
        modelKey: model.definition.apiKey,
        field: target.path,
        fieldType: target.field.type,
        locale: draft.locale,
      },
    },
    async (meter) => ({ ...(await suggestFieldValue(context, meter, subject)), model: meter.model }),
  );
};
