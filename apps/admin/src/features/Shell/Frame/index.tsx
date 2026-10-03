import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { useUiStore } from '@/stores/ui';
import type { ShellNavGroup } from '../hooks/useShellNavGroups';
import { MobileBar } from '../MobileBar';
import { Sidebar } from '../Sidebar';
import { StatusBar } from '../StatusBar';

type FrameProps = {
  groups: readonly ShellNavGroup[];
  activeKey: string | undefined;
  /** The status bar's section name. */
  section: string | undefined;
  searchable: boolean;
  children: ReactNode;
};

/** The signed-in frame: skip link, sidebar, the phone bar, the screen and the status bar. */
export const Frame = ({ groups, activeKey, section, searchable, children }: FrameProps) => {
  const { t } = useTranslation();
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUiStore((state) => state.setSidebarOpen);
  return (
    <SidebarProvider open={sidebarOpen} onOpenChange={setSidebarOpen}>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        {t('app.skipToContent')}
      </a>
      <Sidebar groups={groups} activeKey={activeKey} searchable={searchable} />
      <SidebarInset className="min-w-0">
        <MobileBar searchable={searchable} />
        <div id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-7 outline-none sm:px-8">
          {children}
        </div>
        <StatusBar section={section} />
      </SidebarInset>
    </SidebarProvider>
  );
};
