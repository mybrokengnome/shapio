import type { AppRole, DefinitionListItem } from '@shapio/client';
import { linkOptions, useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useAppRole } from '@/api/appRoles';
import { useDefinitions } from '@/api/schema';
import { FormError } from '@/components/FormError';
import { FormTextareaField } from '@/components/FormTextareaField';
import { FormTextField } from '@/components/FormTextField';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { QueryView } from '@/components/QueryView';
import { SubmitButton } from '@/components/SubmitButton';
import { Badge } from '@/components/ui/badge';
import { FieldGroup } from '@/components/ui/field';
import { UnsavedChangesGuard } from '@/components/UnsavedChangesGuard';
import { useAppRoleEditor } from './hooks/useAppRoleEditor';
import { Matrix } from './Matrix';

type FormProps = { role: AppRole; models: readonly DefinitionListItem[] };

const BUILT_IN_DESCRIPTION_KEYS = {
  public: 'appRoles.publicExplained',
  authenticated: 'appRoles.authenticatedExplained',
} as const;

const builtInDescriptionKey = (key: string) =>
  Object.hasOwn(BUILT_IN_DESCRIPTION_KEYS, key)
    ? BUILT_IN_DESCRIPTION_KEYS[key as keyof typeof BUILT_IN_DESCRIPTION_KEYS]
    : undefined;

const Form = ({ role, models }: FormProps) => {
  const { t } = useTranslation();
  const editor = useAppRoleEditor(role);
  const explanation = role.isSystem ? builtInDescriptionKey(role.key) : undefined;
  const breadcrumb = [
    { label: t('roles.title'), link: linkOptions({ to: '/network/roles' }) },
    { label: t('appRoles.title'), link: linkOptions({ to: '/network/roles/app' }) },
  ];
  return (
    <form noValidate className="space-y-6" onSubmit={(event) => void editor.onSubmit(event)}>
      <PageHeader
        sticky
        breadcrumb={breadcrumb}
        title={role.name}
        badge={role.isSystem ? <Badge variant="secondary">{t('roles.builtIn')}</Badge> : null}
        meta={explanation ? t(explanation) : role.description || undefined}
        actions={
          <SubmitButton pending={editor.pending} pendingLabel={t('common.saving')} disabled={!editor.dirty}>
            {t('common.saveChanges')}
          </SubmitButton>
        }
      />
      {role.isSystem ? null : (
        <Panel title={t('appRoles.details')}>
          <FieldGroup className="max-w-xl">
            <FormTextField
              control={editor.form.control}
              name="name"
              label={t('roles.name')}
              autoComplete="off"
            />
            <FormTextareaField
              control={editor.form.control}
              name="description"
              label={t('roles.roleDescription')}
              rows={2}
            />
          </FieldGroup>
        </Panel>
      )}
      <Panel title={t('roles.permissions')} description={t('appRoles.permissionsHint')} flush>
        <Matrix matrix={editor.matrix} models={models} onChange={editor.setMatrix} />
      </Panel>
      <FormError error={editor.error} />
      <UnsavedChangesGuard when={editor.dirty && !editor.pending} />
    </form>
  );
};

/** Settings → Roles → App roles → one role: its permission matrix (models × actions, own entries, fields). */
export const Editor = () => {
  const { roleId } = useParams({ from: '/app/network/roles/app/$roleId' });
  const role = useAppRole(roleId);
  const models = useDefinitions('model');
  return (
    <Page width="full">
      <QueryView query={role} loadingRows={6}>
        {(loaded) => (
          <QueryView query={models} loadingRows={6}>
            {(definitions) => (
              <Form key={`${loaded.id}:${loaded.version}`} role={loaded} models={definitions} />
            )}
          </QueryView>
        )}
      </QueryView>
    </Page>
  );
};
