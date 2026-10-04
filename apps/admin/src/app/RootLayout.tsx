import { Outlet } from '@tanstack/react-router';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useApplyTheme } from '@/hooks/useApplyTheme';
import { useReconcileTheme } from '@/hooks/useReconcileTheme';

export const RootLayout = () => {
  useApplyTheme();
  useReconcileTheme();
  return (
    <TooltipProvider>
      <Outlet />
      <Toaster closeButton />
    </TooltipProvider>
  );
};
