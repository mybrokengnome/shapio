import type { FieldDefinition } from '@shapio/schema';
import { completeJson, type UsageMeter } from '../../assist/completion.js';
import {
  translatePrompt,
  TranslationAnswerSchema,
  type TranslationSegment,
} from '../../assist/prompts/translate.js';
import { ASSIST_TRANSLATE_CHUNK_CHARS } from '../../constants/assist.js';
import { maskAllows } from '../../content/compiler/policy.js';
import { projectData } from '../../content/compiler/select.js';
import { isLocalizedField, type ContentModel } from '../../content/model.js';
import { buildValidator } from '../../content/validator/index.js';
import type { ContentData } from '../../db/contentData.js';
import { AppError } from '../../helpers/appError.js';
import type { Policy } from '../../permissions/types.js';
import { modelWithPolicy } from '../contentAccess.js';
import type { AssistServiceContext } from './context.js';
import { assertLocale, loadEntryDraft } from './entrySource.js';
import { runAssist } from './runs.js';
import { applyTranslations, collectTextLeaves, type TextLeaf } from './translateWalker.js';

export type TranslateInput = { modelKey: string; entryId: string; from: string; to: string };

/** A problem with a proposed value: the validator's issues (over-limit values) and lost formatting. */
export type TranslationIssue = { path: string; code: string; message: string };

export type TranslateResult = {
  /** The proposed localized fields of the target locale, by API ID, in the editor's input format. */
  data: Record<string, unknown>;
  issues: TranslationIssue[];
  model: string;
};

/** Leaves grouped so each request stays around ASSIST_TRANSLATE_CHUNK_CHARS of text. */
const chunksOf = (leaves: readonly TextLeaf[]): number[][] => {
  const chunks: number[][] = [];
  let current: number[] = [];
  let size = 0;
  leaves.forEach((leaf, index) => {
    if (current.length > 0 && size + leaf.text.length > ASSIST_TRANSLATE_CHUNK_CHARS) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(index);
    size += leaf.text.length;
  });
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
};

const segmentId = (index: number) => `s${index}`;

/** Every segment of the chunk exactly once, nothing else. */
const missingSegments = (expected: readonly string[]) => (answer: { segments: { id: string }[] }) => {
  const seen = new Set(answer.segments.map((segment) => segment.id));
  const missing = expected.filter((id) => !seen.has(id));
  const extra = [...seen].filter((id) => !expected.includes(id));
  return [
    ...(missing.length > 0 ? [`segments missing: ${missing.join(', ')}`] : []),
    ...(extra.length > 0 ? [`unknown segments: ${extra.join(', ')}`] : []),
  ];
};

/**
 * Translates the text leaves of `fields` in a stored document (shared with content-ops). Returns the stored
 * values of those fields in the target locale and the leaves whose formatting was lost.
 */
export const translateDocument = async (
  context: AssistServiceContext,
  meter: UsageMeter,
  input: {
    model: ContentModel;
    fields: readonly FieldDefinition[];
    data: Readonly<ContentData>;
    from: string;
    to: string;
  },
) => {
  const leaves = collectTextLeaves(input.model, input.fields, input.data);
  const translations = leaves.map((leaf) => leaf.text);
  for (const chunk of chunksOf(leaves)) {
    const segments: TranslationSegment[] = chunk.map((index) => {
      const leaf = leaves[index] as TextLeaf;
      return {
        id: segmentId(index),
        text: leaf.text,
        ...(leaf.maxLength ? { maxLength: leaf.maxLength } : {}),
      };
    });
    const prompt = translatePrompt({
      from: input.from,
      to: input.to,
      modelLabel: input.model.definition.label,
      segments,
    });
    const answer = await completeJson(
      context.assist.provider,
      meter,
      {
        name: 'translation',
        schema: TranslationAnswerSchema,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        ...(context.signal ? { signal: context.signal } : {}),
      },
      missingSegments(segments.map((segment) => segment.id)),
    );
    const byId = new Map(answer.segments.map((segment) => [segment.id, segment.text]));
    chunk.forEach((index) => {
      translations[index] = byId.get(segmentId(index)) ?? translations[index] ?? '';
    });
  }
  return applyTranslations(input.model, input.fields, input.data, translations);
};

/** Localized, live fields the caller may both read and write: the only ones a translation proposes. */
export const translatableFields = (model: ContentModel, readPolicy: Policy, updatePolicy: Policy) =>
  model.definition.fields.filter(
    (field) =>
      !field.deprecated &&
      isLocalizedField(model.definition, field) &&
      maskAllows(readPolicy.readMask, field) &&
      maskAllows(updatePolicy.writeMask, field),
  );

/** The validator's issues for the proposed values merged over the source document (required is skipped). */
export const issuesOf = (
  context: AssistServiceContext,
  model: ContentModel,
  source: Readonly<ContentData>,
  translated: Readonly<ContentData>,
): TranslationIssue[] =>
  buildValidator(context.snapshot, model)
    .validate({ ...source, ...translated }, { skipRequired: true })
    .issues.map((issue) => ({ path: issue.path, code: issue.code, message: issue.message }));

/** Stored values → the editor's input format (API IDs, media and relation IDs, components by API ID). */
export const toInputFormat = (
  model: ContentModel,
  fields: readonly FieldDefinition[],
  data: Readonly<ContentData>,
) => {
  const present = fields.filter((field) => data[field.id] !== undefined);
  return projectData(data, {
    model,
    fields: present,
    visibleTargets: null,
    populated: new Map(),
    mediaAssets: null,
  });
};

/**
 * A proposed translation of an entry's localized fields (`read` and `update` on the model). Shared fields are
 * never part of it; the editor creates the target locale's draft from it through the normal save path.
 */
export const translateEntry = async (
  context: AssistServiceContext,
  input: TranslateInput,
): Promise<TranslateResult> => {
  const { model, policy: readPolicy } = await modelWithPolicy(context, input.modelKey, 'read');
  const { policy: updatePolicy } = await modelWithPolicy(context, input.modelKey, 'update');
  if (!model.definition.localized) {
    throw new AppError(400, 'ASSIST_NOT_LOCALIZED', `"${input.modelKey}" is not localized`);
  }
  assertLocale(context, input.from);
  assertLocale(context, input.to);
  if (input.from === input.to) {
    throw new AppError(400, 'ASSIST_SAME_LOCALE', 'Choose two different locales');
  }
  const { draft } = await loadEntryDraft(context, model, readPolicy, input.entryId, input.from);
  const fields = translatableFields(model, readPolicy, updatePolicy);
  return runAssist(
    context,
    {
      action: 'translate',
      target: { type: 'entry', id: input.entryId },
      metadata: { modelKey: model.definition.apiKey, from: input.from, to: input.to },
    },
    async (meter) => {
      const translated = await translateDocument(context, meter, {
        model,
        fields,
        data: draft.data,
        from: input.from,
        to: input.to,
      });
      return {
        data: toInputFormat(model, fields, translated.data),
        issues: [...issuesOf(context, model, draft.data, translated.data), ...translated.issues],
        model: meter.model,
      };
    },
  );
};
