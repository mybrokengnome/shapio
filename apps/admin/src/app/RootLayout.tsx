import { Outlet } from '@tanstack/react-router';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useApplyTheme } from '@/hooks/useApplyTheme';

export const RootLayout = () => {
  useApplyTheme();
  return (
    <TooltipProvider>
      <Outlet />
      <Toaster closeButton />
    </TooltipProvider>
  );
};
