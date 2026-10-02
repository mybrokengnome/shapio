import { Outlet } from '@tanstack/react-router';

/**
 * Scheduled publications, webhooks and deployments. Each tab renders its own
 * `Page` and header (the tabs live in the header, with the tab's actions).
 */
export const Publishing = () => <Outlet />;
