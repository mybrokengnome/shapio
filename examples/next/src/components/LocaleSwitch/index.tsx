'use client';

import { usePathname } from 'next/navigation';
import { switchLocale, type Locale } from '../../lib/site';

type LocaleSwitchProps = { to: Locale; label: string };

/** The current page in the other locale (slugs are shared across locales). */
export const LocaleSwitch = ({ to, label }: LocaleSwitchProps) => {
  const pathname = usePathname();
  return (
    <a href={switchLocale(pathname, to)} hrefLang={to} lang={to}>
      {label}
    </a>
  );
};
