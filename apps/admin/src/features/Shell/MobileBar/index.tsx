import { Link } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOpenCommandPalette } from '@/components/CommandPalette/hooks/useOpenCommandPalette';
import { Button } from '@/components/ui/button';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { Wordmark } from '@/components/Wordmark';
import { UserMenu } from '../UserMenu';

/** Below lg only: the sidebar is a sheet, so this 48px row holds its trigger, the brand, search, the theme switch and the account. */
type MobileBarProps = {
  /** Search (the ⌘K palette); off where there is nothing to search (no role on the site). */
  searchable: boolean;
};

export const MobileBar = ({ searchable }: MobileBarProps) => {
  const { t } = useTranslation();
  const openPalette = useOpenCommandPalette();
  return (
    <div
      data-slot="mobile-bar"
      className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-4 lg:hidden"
    >
      <SidebarTrigger className="size-9" />
      <Link
        to="/"
        aria-label={t('shell.home')}
        className="rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Wordmark size="sm" />
      </Link>
      <div className="flex-1" />
      {searchable ? (
        <Button variant="ghost" size="icon" aria-label={t('shell.search')} onClick={openPalette}>
          <Search aria-hidden="true" />
        </Button>
      ) : null}
      <UserMenu variant="compact" />
    </div>
  );
};
