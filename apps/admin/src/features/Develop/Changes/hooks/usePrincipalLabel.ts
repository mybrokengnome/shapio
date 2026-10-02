import { useTranslation } from 'react-i18next';

/** A delivery reader's name: the token's name, "App users", "Anonymous", or the raw key as a last resort. */
export const usePrincipalLabel = () => {
  const { t } = useTranslation();
  return (principalKey: string, name: string | null | undefined): string => {
    if (name) {
      return name;
    }
    if (principalKey === 'app_users') {
      return t('develop.principals.appUsers');
    }
    if (principalKey === 'anonymous') {
      return t('develop.principals.anonymous');
    }
    return principalKey.startsWith('token:') ? t('develop.principals.deletedToken') : principalKey;
  };
};
