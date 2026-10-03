import { Check, ChevronsUpDown, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { initialsOf } from '@/helpers/initials';
import { useSiteSwitcher } from '../hooks/useSiteSwitcher';

const TILE =
  'flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-foreground [&_svg]:size-4';

/**
 * The sidebar header's site switcher (sites plan §H): the site this page works on, the other sites the admin
 * works on, and the network view for admins who hold a network action. Choosing another site opens it.
 */
export const SiteSwitcher = () => {
  const { t } = useTranslation();
  const { site, sites, isNetworkView, showNetwork, openSite, openNetwork } = useSiteSwitcher();
  if (!site) {
    return null;
  }
  const currentName = isNetworkView ? t('sites.network') : site.name;
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {/* Not modal: the page behind isn't hidden from assistive technology while the short list is open. */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" aria-label={t('sites.switcher.label', { name: currentName })}>
              <span aria-hidden="true" className={TILE}>
                {isNetworkView ? <Globe /> : initialsOf(site.name)}
              </span>
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{currentName}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {isNetworkView ? t('sites.switcher.allSites') : site.key}
                </span>
              </span>
              <ChevronsUpDown className="ml-auto" aria-hidden="true" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            align="start"
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
          >
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t('sites.switcher.sites')}
            </DropdownMenuLabel>
            {sites.map((item) => {
              const isCurrent = !isNetworkView && item.id === site.id;
              return (
                <DropdownMenuItem
                  key={item.id}
                  aria-current={isCurrent ? 'page' : undefined}
                  onSelect={() => openSite(item)}
                >
                  <span aria-hidden="true" className={TILE}>
                    {initialsOf(item.name)}
                  </span>
                  <span className="grid flex-1 leading-tight">
                    <span className="truncate">{item.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{item.key}</span>
                  </span>
                  {isCurrent ? <Check className="ml-auto" aria-hidden="true" /> : null}
                </DropdownMenuItem>
              );
            })}
            {showNetwork ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem aria-current={isNetworkView ? 'page' : undefined} onSelect={openNetwork}>
                  <span aria-hidden="true" className={TILE}>
                    <Globe />
                  </span>
                  <span className="flex-1">{t('sites.network')}</span>
                  {isNetworkView ? <Check className="ml-auto" aria-hidden="true" /> : null}
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
};
