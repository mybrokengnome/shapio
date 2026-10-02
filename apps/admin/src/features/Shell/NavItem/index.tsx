import { Link } from '@tanstack/react-router';
import { SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { cn } from '@/helpers/cn';
import type { ShellNavItem } from '../hooks/useShellNavGroups';

type NavItemProps = { item: ShellNavItem; isActive: boolean };

/** A sidebar destination (active state from the router), with a place's entry count on the right. */
export const NavItem = ({ item, isActive }: NavItemProps) => {
  const Icon = item.icon;
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
        <Link {...item.link} aria-current={isActive ? 'page' : undefined}>
          <Icon aria-hidden="true" />
          <span>{item.label}</span>
        </Link>
      </SidebarMenuButton>
      {item.count !== undefined ? (
        <SidebarMenuBadge className="top-2.5 right-2 text-muted-foreground">
          {item.count.toLocaleString()}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
};
