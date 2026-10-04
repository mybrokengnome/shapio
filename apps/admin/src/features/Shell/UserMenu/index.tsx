import { Link } from '@tanstack/react-router';
import { ChevronsUpDown, LogOut, Palette, UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLogout, useMe } from '@/api/auth';
import { ThemeMenuContent } from '@/components/ThemeMenu/Content';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';
import { initialsOf } from '@/helpers/initials';

type UserMenuProps = {
  /** `sidebar`: name and email in the sidebar footer. `compact`: just the avatar (the phone header). */
  variant?: 'sidebar' | 'compact';
};

/** Signed-in admin, with Profile, Theme and Sign out. */
export const UserMenu = ({ variant = 'sidebar' }: UserMenuProps) => {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const logout = useLogout();
  if (!me) {
    return null;
  }
  const { user } = me;
  const displayName = user.name || user.email;
  const avatar = (
    <Avatar className="size-8 rounded-lg">
      <AvatarFallback className="rounded-lg bg-accent text-xs font-semibold text-accent-foreground dark:bg-muted">
        {initialsOf(displayName)}
      </AvatarFallback>
    </Avatar>
  );
  const content = (
    <DropdownMenuContent
      side={variant === 'sidebar' ? 'top' : 'bottom'}
      align={variant === 'sidebar' ? 'start' : 'end'}
      className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
    >
      <DropdownMenuLabel className="font-normal">
        <span className="block text-xs text-muted-foreground">{t('userMenu.signedInAs')}</span>
        <span className="block truncate font-medium">{user.email}</span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link to="/settings/profile">
          <UserRound aria-hidden="true" />
          {t('userMenu.profile')}
        </Link>
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Palette aria-hidden="true" />
          {t('theme.label')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="min-w-52">
          <ThemeMenuContent />
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => logout.mutate()} disabled={logout.isPending}>
        <LogOut aria-hidden="true" />
        {t('userMenu.signOut')}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
  if (variant === 'compact') {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="rounded-lg" aria-label={t('userMenu.label')}>
            {avatar}
          </Button>
        </DropdownMenuTrigger>
        {content}
      </DropdownMenu>
    );
  }
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" aria-label={t('userMenu.label')}>
              {avatar}
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{displayName}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </span>
              <ChevronsUpDown className="ml-auto" aria-hidden="true" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          {content}
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
};
