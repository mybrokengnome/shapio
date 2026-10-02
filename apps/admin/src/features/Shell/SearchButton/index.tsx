import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useOpenCommandPalette } from '@/components/CommandPalette/hooks/useOpenCommandPalette';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { useShortcutLabel } from '../hooks/useShortcutLabel';

/** Opens the ⌘K palette: the visible way in, and the only one on touch screens. */
export const SearchButton = () => {
  const { t } = useTranslation();
  const open = useOpenCommandPalette();
  const shortcut = useShortcutLabel('K');
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          variant="outline"
          size="nav"
          tooltip={t('shell.search')}
          aria-keyshortcuts="Meta+K Control+K"
          onClick={open}
          className="gap-3 text-muted-foreground"
        >
          <Search aria-hidden="true" />
          <span className="flex-1">{t('shell.search')}</span>
          <kbd className="rounded border bg-background px-1.5 font-sans text-2xs text-muted-foreground group-data-[collapsible=icon]:hidden">
            {shortcut}
          </kbd>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
};
