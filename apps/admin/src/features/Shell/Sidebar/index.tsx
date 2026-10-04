import { Link } from '@tanstack/react-router';
import { memo, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { ThemeToggle } from '@/components/ThemeMenu/Toggle';
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
  Sidebar as SidebarRoot,
  SidebarTrigger,
  useSidebar,
} from '@/components/ui/sidebar';
import { Wordmark } from '@/components/Wordmark';
import type { ShellNavGroup } from '../hooks/useShellNavGroups';
import { NavItem } from '../NavItem';
import { SearchButton } from '../SearchButton';
import { SiteSwitcher } from '../SiteSwitcher';
import { UserMenu } from '../UserMenu';

type SidebarProps = {
  groups: readonly ShellNavGroup[];
  activeKey: string | undefined;
  /** Search (the ⌘K palette); off where there is nothing to search (no role on the site). */
  searchable: boolean;
};

type GroupProps = { group: ShellNavGroup; activeKey: string | undefined };

/** One labelled list of destinations (Content, Develop, Workspace) or an unlabelled one. */
const Group = ({ group, activeKey }: GroupProps) => {
  const labelId = useId();
  return (
    <SidebarGroup className="px-3 py-1">
      {group.label ? <SidebarGroupLabel id={labelId}>{group.label}</SidebarGroupLabel> : null}
      <SidebarGroupContent>
        <SidebarMenu className="gap-1" aria-labelledby={group.label ? labelId : undefined}>
          {group.items.map((item) => (
            <NavItem key={item.key} item={item} isActive={item.key === activeKey} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

/**
 * Wordmark, the site switcher and search, the navigation groups, and the account menu with the theme switch. Memoized: the shell re-renders on
 * every location change (search params included), the sidebar only when its groups or active item change.
 */
export const Sidebar = memo(function Sidebar({ groups, activeKey, searchable }: SidebarProps) {
  const { t } = useTranslation();
  const { isMobile } = useSidebar();
  return (
    <SidebarRoot collapsible="icon">
      <SidebarHeader className="gap-3 px-3 pt-5 pb-2">
        <div className="flex items-center justify-between gap-2 group-data-[collapsible=icon]:flex-col">
          <Link
            to="/"
            aria-label={t('shell.home')}
            className="rounded-md px-1 outline-none group-data-[collapsible=icon]:px-0 focus-visible:ring-[3px] focus-visible:ring-sidebar-ring/50"
          >
            <Wordmark className="group-data-[collapsible=icon]:[&>[data-slot=wordmark-letters]]:hidden" />
          </Link>
          {/* The sheet closes with Escape or a tap outside; the visible trigger is for the desktop column. */}
          {isMobile ? null : <SidebarTrigger />}
        </div>
        <SiteSwitcher />
        {searchable ? <SearchButton /> : null}
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label={t('shell.mainNavigation')}>
          {groups.map((group) => (
            <Group key={group.key} group={group} activeKey={activeKey} />
          ))}
        </nav>
      </SidebarContent>
      <SidebarFooter className="flex-row items-center gap-1 px-3 pb-4 group-data-[collapsible=icon]:flex-col">
        <div className="min-w-0 flex-1">
          <UserMenu />
        </div>
        <ThemeToggle />
      </SidebarFooter>
      <SidebarRail />
    </SidebarRoot>
  );
});
