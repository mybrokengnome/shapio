import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { SharedGlyph } from '@/components/SharedGlyph';
import { SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { cn } from '@/helpers/cn';
import type { ShellNavItem } from '../hooks/useShellNavGroups';
import { Kinds } from './Kinds';

type NavItemProps = { item: ShellNavItem; activeKey: string | undefined };

/**
 * A sidebar destination (active state from the router), with a place's entry count on the right, a small
 * globe after a place shared with all sites, and the kinds that extend it nested underneath.
 */
export const NavItem = ({ item, activeKey }: NavItemProps) => {
  const { t } = useTranslation();
  const Icon = item.icon;
  const isActive = item.key === activeKey;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        variant="nav"
        size="nav"
        isActive={isActive}
        tooltip={item.label}
        className={cn(item.variant === 'add' && 'text-muted-foreground', item.count !== undefined && 'pr-10')}
      >
        <Link
          {...item.link}
          aria-current={isActive ? 'page' : undefined}
          aria-description={item.shared ? t('contentTypes.sharedWithAllSites') : undefined}
        >
          <Icon aria-hidden="true" />
          <span className="min-w-0 truncate">{item.label}</span>
          {item.shared ? <SharedGlyph decorative className="group-data-[collapsible=icon]:hidden" /> : null}
        </Link>
      </SidebarMenuButton>
      {item.count !== undefined ? (
        <SidebarMenuBadge className="top-2.5 right-2 text-muted-foreground">
          {item.count.toLocaleString()}
        </SidebarMenuBadge>
      ) : null}
      {item.children ? <Kinds items={item.children} activeKey={activeKey} /> : null}
    </SidebarMenuItem>
  );
};
