import { Outlet, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useMe } from '@/api/auth';
import { CommandPalette } from '@/components/CommandPalette';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useUiStore } from '@/stores/ui';
import { useActiveNavKey } from './hooks/useActiveNavKey';
import { useShellNavGroups } from './hooks/useShellNavGroups';
import { useShellPaletteItems } from './hooks/useShellPaletteItems';
import { MobileBar } from './MobileBar';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';

/**
 * Signed-in frame: sidebar, the current screen, the status bar and the ⌘K palette. No desktop top bar
 * (DESIGN.md): below lg a 48px row holds the sidebar trigger. Leaves for sign-in when the session ends.
 */
export const Shell = () => {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const router = useRouter();
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
  const groups = useShellNavGroups();
  const activeKey = useActiveNavKey(groups);
  const section = groups.flatMap((group) => group.items).find((item) => item.key === activeKey)?.label;
  useShellPaletteItems(groups);
  // The session ended (sign-out, expiry, revoked elsewhere): re-run the route guard, which sends the
  // visitor to sign in and remembers where they were.
  useEffect(() => {
    if (me === null) {
      void router.invalidate();
    }
  }, [me, router]);
  if (me === null) {
    return null;
  }
  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t('app.skipToContent')}
      </a>
      <Sidebar groups={groups} activeKey={activeKey} />
      <SidebarInset className="min-w-0">
        <MobileBar />
        <div id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-7 outline-none sm:px-8">
          <Outlet />
        </div>
        <StatusBar section={section} />
      </SidebarInset>
      <CommandPalette />
    </SidebarProvider>
  );
};
