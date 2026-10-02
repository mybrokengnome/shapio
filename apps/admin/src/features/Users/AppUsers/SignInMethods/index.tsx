import type { AdminAppUser } from '@shapio/client';
import { KeyRound, LogIn } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { GithubIcon, GoogleIcon } from './icons';

type SignInMethodsProps = { user: AdminAppUser };

type MethodIcon = ComponentType<SVGProps<SVGSVGElement>>;

const PROVIDERS = {
  google: { labelKey: 'appUsers.providerGoogle', icon: GoogleIcon },
  github: { labelKey: 'appUsers.providerGithub', icon: GithubIcon },
} as const satisfies Record<string, { labelKey: string; icon: MethodIcon }>;

const isKnownProvider = (provider: string): provider is keyof typeof PROVIDERS =>
  Object.hasOwn(PROVIDERS, provider);

/** How an app user signs in: password and each linked provider, as icon chips. */
export const SignInMethods = ({ user }: SignInMethodsProps) => {
  const { t } = useTranslation();
  const methods: { key: string; label: string; icon: MethodIcon }[] = [
    ...(user.hasPassword ? [{ key: 'password', label: t('appUsers.password'), icon: KeyRound }] : []),
    ...user.providers.map((provider) =>
      isKnownProvider(provider)
        ? { key: provider, label: t(PROVIDERS[provider].labelKey), icon: PROVIDERS[provider].icon }
        : { key: provider, label: provider, icon: LogIn },
    ),
  ];
  return (
    <span className="flex flex-wrap gap-1">
      {methods.map(({ key, label, icon: Icon }) => (
        <Badge key={key} variant="outline">
          <Icon aria-hidden="true" />
          {label}
        </Badge>
      ))}
    </span>
  );
};
