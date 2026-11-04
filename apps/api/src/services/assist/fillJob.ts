import { effectiveTitleField } from '@shapio/schema';
import type { UsageMeter } from '../../assist/completion.js';
import type { FillRule } from '../../constants/assist.js';
import { maskAllows, rowReadMask, rowWriteMask } from '../../content/compiler/policy.js';
import { writeLocaleFor } from '../../content/locales.js';
import { resolveModel, type ContentModel } from '../../content/model.js';
import { buildValidator } from '../../content/validator/index.js';
import { modelWithPolicy } from '../contentAccess.js';
import { isRunFatal, reasonOf, type Skipped } from './contentOpsShared.js';
import type { AssistServiceContext } from './context.js';
import { loadEntryDraft } from './entrySource.js';
import { fieldEmptyGroups, requiredEmptyGroups, type FillGroup } from './fillTargets.js';
import { subjectSource, suggestFieldValue, type SuggestedValue } from './suggest.js';
import { fieldLabelOf, isTargetEmpty, resolveSuggestTarget, type SuggestTarget } from './suggestTarget.js';

/**
 * A proposed value for an empty field of an entry's draft (plan write-and-fill §3). Nothing is written until
 * it is accepted (`fillAccept.ts`). `options`/`multiple` describe an enum, `maxLength` a string or text.
 */
export type FieldProposal = {
  key: string;
  entryId: string;
  modelKey: string;
  entryTitle: string | null;
  locale: string;
  fieldPath: string;
  fieldLabel: string;
  fieldType: SuggestTarget['field']['type'];
  proposedValue: SuggestedValue;
  /** The draft version the value was proposed from (informational: accept guards the field). */
  entryVersion: number;
  maxLength?: number;
  multiple?: boolean;
  options?: { value: string; label: string }[];
};

export type FillResult = {
  rule: FillRule;
  proposals: FieldProposal[];
  skipped: Skipped[];
  scanCapped: boolean;
};

/** What a fill run reads from its job payload. */
export type FillInput = {
  rule: FillRule;
  modelKey: string | null;
  fieldPath: string | null;
  locale: string | null;
};

/** The run's progress: kept in the job checkpoint so an attempt resumes where the last one stopped. */
export type FillProgress = {
  context: AssistServiceContext;
  meter: UsageMeter;
  signal: AbortSignal;
  done: string[];
  proposals: FieldProposal[];
  skipped: Skipped[];
  save: () => Promise<void>;
};

export const proposalKey = (entryId: string, locale: string, fieldPath: string) =>
  `entry:${entryId}:${locale}:${fieldPath}`;

/** The entry locales to work on, newest first, at most 50 (`fillTargets.ts`). */
export const loadFillGroups = async (
  context: AssistServiceContext,
  input: FillInput,
): Promise<{ groups: FillGroup[]; scanCapped: boolean }> => {
  if (input.rule === 'requiredEmpty') {
    return { groups: await requiredEmptyGroups(context, input.modelKey), scanCapped: false };
  }
  const model = resolveModel(context.snapshot, input.modelKey ?? '');
  return fieldEmptyGroups(context, {
    modelKey: model.definition.apiKey,
    target: resolveSuggestTarget(model, input.fieldPath ?? ''),
    locale: writeLocaleFor(context.snapshot, model.definition, input.locale ?? undefined),
    localized: model.definition.localized,
  });
};

const shapeOf = (target: SuggestTarget): Pick<FieldProposal, 'maxLength' | 'multiple' | 'options'> => {
  const { field } = target;
  if (field.type === 'enum') {
    return { multiple: field.settings.multiple, options: field.settings.values };
  }
  return field.settings.maxLength === undefined ? {} : { maxLength: field.settings.maxLength };
};

type GroupContext = { progress: FillProgress; group: FillGroup };

const skip = (
  { progress, group }: GroupContext,
  paths: readonly string[],
  reason: string,
  detail?: unknown,
) => {
  for (const path of paths) {
    progress.skipped.push({
      key: proposalKey(group.entryId, group.locale, path),
      entryId: group.entryId,
      locale: group.locale,
      reason,
      ...(detail === undefined ? {} : { detail }),
    });
  }
};

/** The fields of the group that can be proposed for, after skipping the others with their reason. */
const proposableTargets = (
  scope: GroupContext,
  model: ContentModel,
  writable: (target: SuggestTarget) => boolean,
  data: Parameters<typeof isTargetEmpty>[0],
): SuggestTarget[] => {
  const targets: SuggestTarget[] = [];
  for (const path of scope.group.fieldPaths) {
    let target: SuggestTarget;
    try {
      target = resolveSuggestTarget(model, path);
    } catch {
      skip(scope, [path], 'fieldNotSuggestible');
      continue;
    }
    if (!writable(target)) {
      skip(scope, [path], 'notEditable');
    } else if (!isTargetEmpty(data, target)) {
      skip(scope, [path], 'filledMeanwhile');
    } else {
      targets.push(target);
    }
  }
  return targets;
};

/**
 * One entry locale: its draft is read again, and each field gets a proposal unless the content type publishes
 * on save, the draft holds unsaved autosaved work, the caller may not edit the field, the field was filled
 * meanwhile, or another required field this run proposes nothing for would make every accept fail.
 */
const proposeGroup = async (scope: GroupContext) => {
  const { progress, group } = scope;
  const { context } = progress;
  let model: ContentModel;
  try {
    model = resolveModel(context.snapshot, group.modelKey);
  } catch {
    skip(scope, group.fieldPaths, 'modelMissing');
    return;
  }
  if (!model.definition.draftAndPublish) {
    skip(scope, group.fieldPaths, 'publishesOnSave');
    return;
  }
  const { policy: readPolicy } = await modelWithPolicy(context, group.modelKey, 'read');
  const updatePolicy = await context.permissions.evaluate(context.actor, {
    action: 'update',
    modelId: model.definition.id,
  });
  if (!updatePolicy.allowed) {
    skip(scope, group.fieldPaths, 'notEditable');
    return;
  }
  const { entry, draft } = await loadEntryDraft(context, model, readPolicy, group.entryId, group.locale);
  if (draft.autosaved_at) {
    skip(scope, group.fieldPaths, 'unsavedWork');
    return;
  }
  const writeMask = rowWriteMask(updatePolicy, context.actor, entry);
  const targets = proposableTargets(
    scope,
    model,
    (target) => maskAllows(writeMask, target.topField),
    draft.data,
  );
  if (targets.length === 0) {
    return;
  }
  const blocking = buildValidator(context.snapshot, model)
    .validate(draft.data)
    .issues.filter((issue) => issue.code === 'REQUIRED')
    .map((issue) => issue.path)
    .filter((path) => !targets.some((target) => target.path === path));
  if (blocking.length > 0) {
    skip(
      scope,
      targets.map((target) => target.path),
      'otherRequiredEmpty',
      { paths: blocking },
    );
    return;
  }
  const readMask = rowReadMask(readPolicy, context.actor, entry);
  const title = effectiveTitleField(model.definition);
  const titleValue = title && maskAllows(readMask, title) ? draft.data[title.id] : undefined;
  for (const target of targets) {
    try {
      const subject = { model, target, data: draft.data, locale: draft.locale, readMask };
      const suggested = await suggestFieldValue(
        { ...context, signal: progress.signal },
        progress.meter,
        subject,
        subjectSource(subject),
      );
      progress.proposals.push({
        key: proposalKey(group.entryId, group.locale, target.path),
        entryId: group.entryId,
        modelKey: model.definition.apiKey,
        entryTitle: typeof titleValue === 'string' && titleValue.trim() !== '' ? titleValue : null,
        locale: draft.locale,
        fieldPath: target.path,
        fieldLabel: fieldLabelOf(target),
        fieldType: target.field.type,
        proposedValue: suggested.value,
        entryVersion: draft.version,
        ...shapeOf(target),
      });
    } catch (error) {
      if (isRunFatal(error)) {
        throw error;
      }
      skip(scope, [target.path], reasonOf(error));
    }
  }
};

/** Proposes values for each group not done yet, saving progress after each. Nothing is written. */
export const proposeFills = async (progress: FillProgress, groups: readonly FillGroup[]) => {
  for (const group of groups) {
    const key = `entry:${group.entryId}:${group.locale}`;
    if (progress.done.includes(key) || progress.signal.aborted) {
      continue;
    }
    try {
      await proposeGroup({ progress, group });
    } catch (error) {
      if (isRunFatal(error)) {
        throw error;
      }
      skip({ progress, group }, group.fieldPaths, reasonOf(error));
    }
    progress.done.push(key);
    await progress.save();
  }
};
