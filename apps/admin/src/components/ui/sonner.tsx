import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { useResolvedScheme } from '@/hooks/useResolvedScheme';

// Shapio: the rendered scheme comes from the admin's theme store (shadcn's default used next-themes): the
// saved look's variant.
const Toaster = ({ ...props }: ToasterProps) => {
  const { t } = useTranslation();
  const theme = useResolvedScheme();

  return (
    <Sonner
      theme={theme}
      containerAriaLabel={t('common.notifications')}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-success" />,
        info: <InfoIcon className="size-4 text-info" />,
        warning: <TriangleAlertIcon className="size-4 text-warning" />,
        error: <OctagonXIcon className="size-4 text-destructive" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{ closeButtonAriaLabel: t('common.close') }}
      // Shapio: clear the Shell's status bar (md and up); phones have no status bar.
      offset={{ bottom: 'calc(var(--statusbar-h) + 16px)' }}
      style={
        {
          fontFamily: 'var(--font-sans)',
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'calc(var(--radius) + 4px)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
