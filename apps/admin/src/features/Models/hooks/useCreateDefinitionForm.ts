import { zodResolver } from '@hookform/resolvers/zod';
import type { DefinitionScope } from '@shapio/client';
import {
  categoryOfKind,
  foldApiKey,
  routeKeyOf,
  type DefinitionInput,
  type InterfaceDefinition,
  type ModelDefinition,
  type SchemaDefinition,
} from '@shapio/schema';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useMe } from '@/api/auth';
import { schemaIssuesOf } from '@/api/errors';
import { useAllDefinitions, useCreateDefinition, useDefinitions } from '@/api/schema';
import { i18next } from '@/app/i18n';
import { settle } from '@/helpers/settle';
import { requiredText } from '@/helpers/validation';
import { apiKeyField, pluralApiKeyMessage } from '../helpers/apiKeyField';
import { describeIssue } from '../helpers/describeIssue';
import { contractFieldCopies, interfacesInScope } from '../helpers/interfaces';
import { useApiKeyFromLabel } from './useApiKeyFromLabel';
import { useParentChoices } from './useParentChoices';
import { usePluralFromApiKey } from './usePluralFromApiKey';

/** The "Extends" choice for a type of its own (a select can't hold an empty value). */
export const NO_PARENT = '__none__';

const createSchema = z
  .object({
    kind: z.enum(['collection', 'singleton', 'component', 'interface']),
    label: requiredText(),
    apiKey: apiKeyField(),
    /** Collections and interfaces only (hidden and ignored for the other kinds). */
    pluralApiKey: z.string().trim(),
    description: z.string().trim(),
    localized: z.boolean(),
    /** Sent only for a kind (its parent's value); otherwise the server's default applies. */
    draftAndPublish: z.boolean(),
    /** Collections only: the collection it extends, or NO_PARENT. */
    extends: z.string(),
    /** Where it lives: this site (the default) or shared with all sites. */
    scope: z.enum(['site', 'network']),
    /** Collections and singletons: the interfaces it implements (stable IDs). */
    implements: z.array(z.string()),
  })
  .superRefine((values, context) => {
    const message = hasPlural(values.kind) ? pluralApiKeyMessage(values.apiKey, values.pluralApiKey) : null;
    if (message) {
      context.addIssue({ code: 'custom', path: ['pluralApiKey'], message });
    }
  });

export type CreateDefinitionValues = z.infer<typeof createSchema>;

/** Kinds with a plural API ID: their list route and query. */
export const hasPlural = (kind: CreateDefinitionValues['kind']) =>
  kind === 'collection' || kind === 'interface';

const blank = (kind: CreateDefinitionValues['kind'], scope: DefinitionScope): CreateDefinitionValues => ({
  kind,
  label: '',
  apiKey: '',
  pluralApiKey: '',
  description: '',
  localized: false,
  draftAndPublish: true,
  extends: NO_PARENT,
  scope,
  implements: [],
});

/**
 * The definition to create. A kind (a collection that extends `parent`) carries the parent's ID and, sent
 * explicitly, the parent's localization and drafts (they must be equal). A type that implements interfaces
 * starts with copies of their contract fields (`contracts`, the chosen interfaces), so it is valid at once.
 */
const toDefinition = (
  values: CreateDefinitionValues,
  parent: ModelDefinition | undefined,
  contracts: readonly InterfaceDefinition[],
): DefinitionInput => {
  const { kind, label, apiKey, pluralApiKey, description } = values;
  if (kind === 'component') {
    return { kind, label, apiKey, description, fields: [] };
  }
  if (kind === 'interface') {
    return { kind, label, apiKey, pluralApiKey, description, fields: [] };
  }
  const localized = parent ? parent.localized : values.localized;
  // A kind inherits its parent's fields (and what they implement): only what the parent lacks is copied.
  const inherited = parent?.fields ?? [];
  // Stored fields are valid input (normalized, with their IDs).
  const fields = contractFieldCopies(contracts, inherited, localized) as DefinitionInput['fields'];
  const implementing = contracts.length > 0 ? { implements: contracts.map(({ id }) => id) } : {};
  if (kind === 'collection' && parent) {
    return {
      kind,
      label,
      apiKey,
      pluralApiKey,
      description,
      extends: parent.id,
      localized: parent.localized,
      draftAndPublish: parent.draftAndPublish,
      ...implementing,
      fields,
    };
  }
  return kind === 'collection'
    ? { kind, label, apiKey, pluralApiKey, description, localized, ...implementing, fields }
    : { kind, label, apiKey, description, localized, ...implementing, fields };
};

/**
 * API IDs already claimed (case-folded): every definition's API ID and every collection's and interface's
 * plural (one namespace of route keys).
 */
const takenKeys = (definitions: ReadonlyArray<{ definition: SchemaDefinition }> | undefined) =>
  new Set(
    (definitions ?? []).flatMap(({ definition }) =>
      [definition.apiKey, ...(definition.kind === 'component' ? [] : [routeKeyOf(definition)])].map(
        foldApiKey,
      ),
    ),
  );

/** Server issues shown on a form field, by the definition property they point at. */
const ISSUE_FIELDS = ['label', 'apiKey', 'pluralApiKey', 'extends', 'implements'] as const;

/** Whether an issue points at the form field `name` (or inside it: `/implements/0`). */
const isAt = (path: string, name: string) => path === `/${name}` || path.startsWith(`/${name}/`);

/**
 * The message for a refusal whose issues point at no field on this form (the generic "fix the highlighted
 * settings" would highlight nothing), or undefined when the form error can describe it itself.
 */
const unplacedIssuesMessage = (error: unknown): string | undefined => {
  const issues = schemaIssuesOf(error);
  if (issues.length === 0 || issues.some((issue) => ISSUE_FIELDS.some((name) => isAt(issue.path, name)))) {
    return undefined;
  }
  return issues.map((issue) => describeIssue(issue)).join(' ');
};

/**
 * Creates an empty model, component or interface, live (a new definition has no content, so it activates
 * at once), then opens it in the builder. The API key follows the label, and a collection's or interface's
 * plural API ID follows the API key, until the user edits them. It belongs to this site unless `scope` says
 * otherwise (the network view creates shared definitions only). A collection may extend another in the
 * same scope (`parentChoices`): its localization and drafts then follow that parent. A collection or
 * singleton may implement interfaces in its scope (`interfaceChoices`) and starts with their contract fields.
 */
export const useCreateDefinitionForm = (
  initialKind: CreateDefinitionValues['kind'],
  initialScope: DefinitionScope = 'site',
) => {
  const createDefinition = useCreateDefinition();
  const { definitions } = useAllDefinitions();
  const navigate = useNavigate();
  const form = useForm<CreateDefinitionValues>({
    resolver: zodResolver(createSchema),
    defaultValues: blank(initialKind, initialScope),
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

  const [kind, scope, parentId, implementing] = useWatch({
    control: form.control,
    name: ['kind', 'scope', 'extends', 'implements'],
  });
  const siteId = useMe().data?.site.id ?? null;
  const { parentChoices } = useParentChoices({ scope, siteId });
  const offered = kind === 'collection' ? parentChoices : [];
  const parent = offered.find((choice) => choice.id === parentId);
  const { data: interfaceItems } = useDefinitions('interface');
  const interfaceChoices = useMemo(
    () =>
      kind === 'collection' || kind === 'singleton'
        ? interfacesInScope(interfaceItems ?? [], { scope, siteId })
        : [],
    [interfaceItems, kind, scope, siteId],
  );
  // Interfaces no longer offered (another shape or scope) are dropped.
  useEffect(() => {
    const kept = implementing.filter((id) => interfaceChoices.some((choice) => choice.id === id));
    if (kept.length !== implementing.length) {
      setValue('implements', kept);
    }
  }, [implementing, interfaceChoices, setValue]);
  // A parent that is no longer offered (another shape or scope) is dropped; a kind's flags are its parent's.
  useEffect(() => {
    if (parentId !== NO_PARENT && !parent) {
      setValue('extends', NO_PARENT);
    }
  }, [parentId, parent, setValue]);
  useEffect(() => {
    if (parent) {
      setValue('localized', parent.localized);
      setValue('draftAndPublish', parent.draftAndPublish);
    }
  }, [parent, setValue]);

  const onSubmit = form.handleSubmit(async (values) => {
    const taken = takenKeys(definitions);
    if (taken.has(foldApiKey(values.apiKey))) {
      setError('apiKey', { message: 'validation.apiKeyTaken' });
      return;
    }
    if (hasPlural(values.kind) && taken.has(foldApiKey(values.pluralApiKey))) {
      setError('pluralApiKey', { message: 'validation.apiKeyTaken' });
      return;
    }
    const category = categoryOfKind(values.kind);
    const contracts = interfaceChoices.filter((choice) => values.implements.includes(choice.id));
    const created = await settle(
      createDefinition.mutateAsync({
        category,
        input: { definition: toDefinition(values, parent, contracts), scope: values.scope },
      }),
    );
    if (!created.ok) {
      const issues = schemaIssuesOf(created.error);
      for (const name of ISSUE_FIELDS) {
        const found = issues.find((candidate) => isAt(candidate.path, name));
        if (found) {
          setError(name, { message: describeIssue(found) });
        }
      }
      return;
    }
    toast.success(i18next.t('models.created'));
    const id = created.value.definitionId;
    // The form is still dirty: the unsaved-changes guard must not ask about what was just created.
    if (category === 'component') {
      await navigate({
        to: '/models/components/$componentId',
        params: { componentId: id },
        ignoreBlocker: true,
      });
    } else if (category === 'interface') {
      await navigate({
        to: '/develop/interfaces/$interfaceId',
        params: { interfaceId: id },
        ignoreBlocker: true,
      });
    } else {
      await navigate({ to: '/models/$modelId', params: { modelId: id }, ignoreBlocker: true });
    }
  });
  return {
    form,
    onSubmit,
    /** The collections it may extend (none unless it is a collection). */
    parentChoices: offered,
    /** The collection chosen in "Extends", if any. */
    parent,
    /** The interfaces it may implement (collections and singletons, in its scope). */
    interfaceChoices,
    pending: createDefinition.isPending,
    error: createDefinition.error,
    errorMessage: unplacedIssuesMessage(createDefinition.error),
  };
};
