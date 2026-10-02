import { useTranslation } from 'react-i18next';
import { useSchemaVersion } from '@/api/schema';
import { Wordmark } from '@/components/Wordmark';

type StatusBarProps = { section: string | undefined };

/**
 * The 32px bar under every screen (md and up): where you are, and that the schema is live. Plain text, not
 * a live region: it changes with navigation and schema activations, and announcing that would be noise.
 */
export const StatusBar = ({ section }: StatusBarProps) => {
  const { t } = useTranslation();
  const { data: schemaVersion } = useSchemaVersion();
  return (
    <div
      data-slot="status-bar"
      className="sticky bottom-0 z-20 hidden h-(--statusbar-h) shrink-0 items-center justify-between gap-4 border-t bg-background px-4 text-xs sm:px-8 md:flex"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Wordmark size="sm" className="opacity-80" />
        {section ? (
          <>
            <span aria-hidden="true" className="h-3.5 w-px bg-border" />
            <span className="truncate font-semibold tracking-wide text-muted-foreground uppercase">
              {section}
            </span>
          </>
        ) : null}
      </div>
      {schemaVersion !== undefined ? (
        <p className="flex items-center gap-2 truncate text-muted-foreground">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />
          {t('statusBar.schema', { version: schemaVersion })}
        </p>
      ) : null}
    </div>
  );
};
