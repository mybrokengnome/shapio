import type { SiteAppRoles } from '@shapio/client';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useSetSiteAppRoles } from '@/api/sites';
import { i18next } from '@/app/i18n';
import { settle } from '@/helpers/settle';

export type AppRoleBindingsValues = { public: string[]; authenticated: string[] };

/** Which app roles apply on this site to anonymous callers and to every signed-in app user. */
export const useAppRoleBindingsForm = (bindings: SiteAppRoles) => {
  const setBindings = useSetSiteAppRoles();
  const form = useForm<AppRoleBindingsValues>({
    defaultValues: { public: bindings.public, authenticated: bindings.authenticated },
  });
  const { reset, formState } = form;
  useEffect(() => {
    if (!formState.isDirty) {
      reset({ public: bindings.public, authenticated: bindings.authenticated });
    }
  }, [bindings, reset, formState.isDirty]);
  const onSubmit = form.handleSubmit(async (values) => {
    const saved = await settle(setBindings.mutateAsync({ id: bindings.siteId, input: values }));
    if (!saved.ok) {
      return;
    }
    reset({ public: saved.value.public, authenticated: saved.value.authenticated });
    toast.success(i18next.t('sites.appRoles.saved'));
  });
  return { form, onSubmit, setBindings };
};
