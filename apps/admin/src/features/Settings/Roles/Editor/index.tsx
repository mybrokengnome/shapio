import type { Role } from '@shapio/client';
import { linkOptions, useParams } from '@tanstack/react-router';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useRole } from '@/api/roles';
import { useEverySiteModels, type SiteModel } from '@/api/schema';
import { FormCheckboxGroup } from '@/components/FormCheckboxGroup';
import { FormError } from '@/components/FormError';
import { FormTextareaField } from '@/components/FormTextareaField';
import { FormTextField } from '@/components/FormTextField';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { QueryView } from '@/components/QueryView';
import { SubmitButton } from '@/components/SubmitButton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { FieldGroup } from '@/components/ui/field';
import { UnsavedChangesGuard } from '@/components/UnsavedChangesGuard';
import { ACTION_LABEL_KEYS, CHECKBOX_ACTIONS_BY_KIND, MATRIX_RULES_BY_KIND } from '../constants';
import { PermissionMatrix } from '../PermissionMatrix';
import { useRoleEditor } from './hooks/useRoleEditor';

type FormProps = { role: Role; models: readonly SiteModel[]; showSites: boolean };

const KIND_LABEL_KEYS = { admin: 'roles.kindAdmin', delivery: 'roles.kindDelivery' } as const;
const CONTENT_HINT_KEYS = { admin: 'roles.contentHintAdmin', delivery: 'roles.contentHintDelivery' } as const;
const CHECKBOX_LEGEND_KEYS = { admin: 'roles.instancePermissions', delivery: 'roles.drafts' } as const;

const Form = ({ role, models, showSites }: FormProps) => {
  const { t } = useTranslation();
  const editor = useRoleEditor(role);
  const readOnly = role.isSystem;
  const breadcrumb = [{ label: t('roles.title'), link: linkOptions({ to: '/network/roles' }) }];
  return (
    <form noValidate className="space-y-6" onSubmit={(event) => void editor.onSubmit(event)}>
      <PageHeader
        sticky
        breadcrumb={breadcrumb}
        title={role.name}
        badge={
          <Badge variant={role.isSystem ? 'secondary' : 'outline'}>
            {role.isSystem ? t('roles.builtIn') : t('roles.custom')}
          </Badge>
        }
        meta={`${t(KIND_LABEL_KEYS[role.kind])} · ${role.key}`}
        actions={
          readOnly ? null : (
            <SubmitButton pending={editor.pending} pendingLabel={t('common.saving')} disabled={!editor.dirty}>
              {t('common.saveChanges')}
            </SubmitButton>
          )
        }
      />
      {readOnly ? (
        <Alert variant="info" role="note">
          <Info aria-hidden="true" />
          <AlertDescription>{t('roles.builtInReadOnly')}</AlertDescription>
        </Alert>
      ) : (
        <Panel title={t('roles.details')}>
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
      <Panel title={t('roles.contentPermissions')} description={t(CONTENT_HINT_KEYS[role.kind])} flush>
        <PermissionMatrix
          matrix={editor.matrix}
          models={models}
          showSites={showSites}
          rules={MATRIX_RULES_BY_KIND[role.kind]}
          audience={role.kind === 'admin' ? 'admin' : 'delivery'}
          readOnly={readOnly}
          onChange={editor.setMatrix}
        />
      </Panel>
      <Panel>
        <FormCheckboxGroup
          control={editor.form.control}
          name="actions"
          legend={t(CHECKBOX_LEGEND_KEYS[role.kind])}
          disabled={readOnly}
          options={CHECKBOX_ACTIONS_BY_KIND[role.kind].map((action) => ({
            value: action,
            label: t(ACTION_LABEL_KEYS[action]),
            ...(action === 'readDrafts' ? { hint: t('roles.actions.readDraftsHint') } : {}),
          }))}
        />
      </Panel>
      <FormError error={editor.error} />
      <UnsavedChangesGuard when={editor.dirty && !editor.pending} />
    </form>
  );
};

/** Network → Roles → one admin or delivery role: details, its permission matrix, and every-model actions. */
export const Editor = () => {
  const { roleId } = useParams({ from: '/app/network/roles/$roleId' });
  const role = useRole(roleId);
  const models = useEverySiteModels();
  return (
    <Page width="full">
      <QueryView query={role} loadingRows={6}>
        {(loaded) => (
          <QueryView query={models} loadingRows={6}>
            {({ models: siteModels, siteCount }) => (
              <Form
                key={`${loaded.id}:${loaded.version}`}
                role={loaded}
                models={siteModels}
                showSites={siteCount > 1}
              />
            )}
          </QueryView>
        )}
      </QueryView>
    </Page>
  );
};
