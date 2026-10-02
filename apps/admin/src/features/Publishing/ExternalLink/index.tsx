import { ExternalLink as ExternalLinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

type ExternalLinkProps = { href: string; children: ReactNode };

/** A link that leaves the admin in a new tab, without giving the other site access to this window. */
export const ExternalLink = ({ href, children }: ExternalLinkProps) => {
  const { t } = useTranslation();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 rounded-sm font-medium break-all text-link underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {children}
      <ExternalLinkIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t('publishing.opensInNewTab')}</span>
    </a>
  );
};
