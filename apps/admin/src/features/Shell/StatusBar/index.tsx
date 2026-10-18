import { useTranslation } from 'react-i18next';
import { useSchemaVersion } from '@/api/schema';
import { useServerVersion } from '@/api/system';
import { Wordmark } from '@/components/Wordmark';
import { CHANGELOG_URL } from '@/constants/shell';

type StatusBarProps = { section: string | undefined };

/**
 * The 32px bar under every screen (md and up): where you are, the Shapio version running (a link to the
 * changelog; Node's version on hover), and that the schema is live. Plain text, not a live region: it
 * changes with navigation and schema activations, and announcing that would be noise.
 */
export const StatusBar = ({ section }: StatusBarProps) => {
  const { t } = useTranslation();
  const { data: schemaVersion } = useSchemaVersion();
  const { data: server } = useServerVersion();
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
      <p className="flex min-w-0 items-center gap-2 text-muted-foreground">
        {server ? (
          <>
            <a
              href={CHANGELOG_URL}
              target="_blank"
              rel="noopener noreferrer"
              title={t('statusBar.versionTitle', { node: server.node })}
              className="shrink-0 rounded-sm underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              {t('statusBar.shapio', { version: server.version })}
            </a>
            {schemaVersion !== undefined ? <span aria-hidden="true">·</span> : null}
          </>
        ) : null}
        {schemaVersion !== undefined ? (
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />
            <span className="truncate">{t('statusBar.schema', { version: schemaVersion })}</span>
          </span>
        ) : null}
      </p>
    </div>
  );
};
