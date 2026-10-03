import { useLocation } from '@tanstack/react-router';
import { isNetworkPath } from '@/app/sitePaths';

/** Whether the current screen is a network page (`/network/*`) rather than one of the site's. */
export const useIsNetworkView = () => useLocation({ select: (location) => isNetworkPath(location.pathname) });
