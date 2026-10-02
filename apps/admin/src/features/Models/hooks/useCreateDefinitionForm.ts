import { zodResolver } from '@hookform/resolvers/zod';
import {
  foldApiKey,
  isModelDefinition,
  routeKeyOf,
  type DefinitionInput,
  type SchemaDefinition,
} from '@shapio/schema';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { schemaIssuesOf } from '@/api/errors';
import { useAllDefinitions, useCreateDefinition } from '@/api/schema';
import { i18next } from '@/app/i18n';
import { settle } from '@/helpers/settle';
import { requiredText } from '@/helpers/validation';
import { categoryOfKind } from '../constants';
import { apiKeyField, pluralApiKeyMessage } from '../helpers/apiKeyField';
import { describeIssue } from '../helpers/describeIssue';
import { useApiKeyFromLabel } from './useApiKeyFromLabel';
import { usePluralFromApiKey } from './usePluralFromApiKey';

const createSchema = z
  .object({
    kind: z.enum(['collection', 'singleton', 'component']),
    label: requiredText(),
    apiKey: apiKeyField(),
    /** Collections only (hidden and ignored for the other kinds). */
    pluralApiKey: z.string().trim(),
    description: z.string().trim(),
    localized: z.boolean(),
  })
  .superRefine((values, context) => {
    const message =
      values.kind === 'collection' ? pluralApiKeyMessage(values.apiKey, values.pluralApiKey) : null;
    if (message) {
      context.addIssue({ code: 'custom', path: ['pluralApiKey'], message });
    }
  });

export type CreateDefinitionValues = z.infer<typeof createSchema>;

const blank = (kind: CreateDefinitionValues['kind']): CreateDefinitionValues => ({
  kind,
  label: '',
  apiKey: '',
  pluralApiKey: '',
  description: '',
  localized: false,
});

const toDefinition = ({
  kind,
  label,
  apiKey,
  pluralApiKey,
  description,
  localized,
}: CreateDefinitionValues): DefinitionInput => {
  if (kind === 'component') {
    return { kind, label, apiKey, description, fields: [] };
  }
  return kind === 'collection'
    ? { kind, label, apiKey, pluralApiKey, description, localized, fields: [] }
    : { kind, label, apiKey, description, localized, fields: [] };
};

/** API IDs already claimed (case-folded): every definition's API ID and every collection's plural. */
const takenKeys = (definitions: ReadonlyArray<{ definition: SchemaDefinition }> | undefined) =>
  new Set(
    (definitions ?? []).flatMap(({ definition }) =>
      [definition.apiKey, ...(isModelDefinition(definition) ? [routeKeyOf(definition)] : [])].map(foldApiKey),
    ),
  );

/** Server issues shown on a form field, by the definition property they point at. */
const ISSUE_FIELDS = ['apiKey', 'pluralApiKey'] as const;

/**
 * Creates an empty model or component, live (a new definition has no content, so it activates at once),
 * then opens it in the builder. The API key follows the label, and a collection's plural API ID follows
 * the API key, until the user edits them.
 */
export const useCreateDefinitionForm = (initialKind: CreateDefinitionValues['kind']) => {
  const createDefinition = useCreateDefinition();
  const { definitions } = useAllDefinitions();
  const navigate = useNavigate();
  const form = useForm<CreateDefinitionValues>({
    resolver: zodResolver(createSchema),
    defaultValues: blank(initialKind),
  });
  const { setValue, setError, getValues } = form;
  const label = useWatch({ control: form.control, name: 'label' });
  useApiKeyFromLabel(
    label,
    useCallback(() => getValues('apiKey'), [getValues]),
    useCallback((apiKey: string) => setValue('apiKey', apiKey, { shouldValidate: false }), [setValue]),
  );
  const apiKey = useWatch({ control: form.control, name: 'apiKey' });
  usePluralFromApiKey(
    apiKey,
    useCallback(() => getValues('pluralApiKey'), [getValues]),
    useCallback((plural: string) => setValue('pluralApiKey', plural, { shouldValidate: false }), [setValue]),
  );

  const onSubmit = form.handleSubmit(async (values) => {
    const taken = takenKeys(definitions);
    if (taken.has(foldApiKey(values.apiKey))) {
      setError('apiKey', { message: 'validation.apiKeyTaken' });
      return;
    }
    if (values.kind === 'collection' && taken.has(foldApiKey(values.pluralApiKey))) {
      setError('pluralApiKey', { message: 'validation.apiKeyTaken' });
      return;
    }
    const category = categoryOfKind(values.kind);
    const created = await settle(
      createDefinition.mutateAsync({ category, input: { definition: toDefinition(values) } }),
    );
    if (!created.ok) {
      const issues = schemaIssuesOf(createDefinition.error);
      for (const name of ISSUE_FIELDS) {
        const found = issues.find((candidate) => candidate.path === `/${name}`);
        if (found) {
          setError(name, { message: describeIssue(found) });
        }
      }
      return;
    }
    toast.success(i18next.t('models.created'));
    const id = created.value.definitionId;
    // The form is still dirty: the unsaved-changes guard must not ask about what was just created.
    await (category === 'component'
      ? navigate({ to: '/models/components/$componentId', params: { componentId: id }, ignoreBlocker: true })
      : navigate({ to: '/models/$modelId', params: { modelId: id }, ignoreBlocker: true }));
  });
  return { form, onSubmit, pending: createDefinition.isPending, error: createDefinition.error };
};
