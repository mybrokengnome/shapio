import { Outlet } from '@tanstack/react-router';
import { Page } from '@/components/Page';
import { Nav } from './Nav';

/** Settings: the section navigation beside the current section's screen. */
export const Settings = () => (
  <Page>
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
      <Nav />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  </Page>
);
