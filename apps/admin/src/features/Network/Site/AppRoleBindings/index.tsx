import type { AppRole, SiteAppRoles } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { useAppRoles } from '@/api/appRoles';
import { useSiteAppRoles } from '@/api/sites';
import { FormCheckboxGroup } from '@/components/FormCheckboxGroup';
import { FormError } from '@/components/FormError';
import { Panel } from '@/components/Panel';
import { QueryView } from '@/components/QueryView';
import { SubmitButton } from '@/components/SubmitButton';
import { FieldGroup } from '@/components/ui/field';
import { UnsavedChangesGuard } from '@/components/UnsavedChangesGuard';
import { useAppRoleBindingsForm } from '../hooks/useAppRoleBindingsForm';

type FormProps = { bindings: SiteAppRoles; roles: readonly AppRole[]; canManage: boolean };

const Form = ({ bindings, roles, canManage }: FormProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, setBindings } = useAppRoleBindingsForm(bindings);
  const options = roles.map((role) => ({ value: role.id, label: role.name }));
  const { isDirty } = form.formState;
  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)}>
      <FieldGroup>
        <FormCheckboxGroup
          control={form.control}
          name="public"
          legend={t('sites.appRoles.public')}
          options={options}
          disabled={!canManage}
        />
        <FormCheckboxGroup
          control={form.control}
          name="authenticated"
          legend={t('sites.appRoles.authenticated')}
          options={options}
          disabled={!canManage}
        />
        <FormError error={setBindings.error} />
        {canManage ? (
          <div>
            <SubmitButton
              pending={setBindings.isPending}
              pendingLabel={t('common.saving')}
              disabled={!isDirty}
            >
              {t('common.saveChanges')}
            </SubmitButton>
          </div>
        ) : null}
      </FieldGroup>
      <UnsavedChangesGuard when={isDirty} />
    </form>
  );
};

type AppRoleBindingsProps = { siteId: string; canManage: boolean };

/**
 * The app roles this site grants (sites plan §H): `public` to anonymous delivery callers, `authenticated` to
 * every signed-in app user of the site. A new site binds nothing, so it shows nothing until bound here.
 */
export const AppRoleBindings = ({ siteId, canManage }: AppRoleBindingsProps) => {
  const { t } = useTranslation();
  const bindings = useSiteAppRoles(siteId);
  const roles = useAppRoles();
  return (
    <Panel title={t('sites.appRoles.title')} description={t('sites.appRoles.description')}>
      <QueryView query={bindings}>
        {(data) => (
          <QueryView query={roles}>
            {(appRoles) => <Form bindings={data} roles={appRoles} canManage={canManage} />}
          </QueryView>
        )}
      </QueryView>
    </Panel>
  );
};
