import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { SharedGlyph } from '@/components/SharedGlyph';
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '@/components/ui/sidebar';
import type { ShellNavItem } from '../../hooks/useShellNavGroups';

type KindsProps = { items: readonly ShellNavItem[]; activeKey: string | undefined };

/**
 * The kinds that extend a place, nested under it with their own counts (any depth). Hidden while the sidebar
 * is collapsed to icons, where only the roots show.
 */
export const Kinds = ({ items, activeKey }: KindsProps) => {
  const { t } = useTranslation();
  return (
    <SidebarMenuSub>
      {items.map((item) => {
        const isActive = item.key === activeKey;
        return (
          <SidebarMenuSubItem key={item.key}>
            <SidebarMenuSubButton asChild isActive={isActive}>
              <Link
                {...item.link}
                aria-current={isActive ? 'page' : undefined}
                aria-description={item.shared ? t('contentTypes.sharedWithAllSites') : undefined}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.shared ? <SharedGlyph decorative /> : null}
                {item.count !== undefined ? (
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {item.count.toLocaleString()}
                  </span>
                ) : null}
              </Link>
            </SidebarMenuSubButton>
            {item.children ? <Kinds items={item.children} activeKey={activeKey} /> : null}
          </SidebarMenuSubItem>
        );
      })}
    </SidebarMenuSub>
  );
};
