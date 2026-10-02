import type { EntryStatus } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import { Link } from '@tanstack/react-router';
import { Check, Loader2, PanelRight, Save, Send } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EntryStatusChip } from '../../EntryStatusChip';

/** The one primary action of the document, by state. */
export type PrimaryAction =
  | { kind: 'publish'; upToDate: boolean; onClick: () => void }
  | { kind: 'create' | 'save'; label: string; pending: boolean; onClick: () => void }
  | { kind: 'none' };

type TopBarProps = {
  model: ModelDefinition;
  title: string;
  status: EntryStatus | undefined;
  saveState: ReactNode;
  presence: ReactNode;
  /** The locale switch, for localized models. */
  locale: ReactNode;
  preview: ReactNode;
  /** Shown while the draft has changes a Save would validate and record (plus ⌘S). */
  onSave: (() => void) | undefined;
  saving: boolean;
  /** A save conflict waits for a decision: nothing can be saved or published. */
  blocked: boolean;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  primary: PrimaryAction;
};

const spinnerOr = (busy: boolean, icon: ReactNode) =>
  busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : icon;

/**
 * The document's thin sticky bar: where you are (place / title), its state (status, save state, who else
 * is here) and its actions (locale, Preview, Settings, then the primary: Publish, Create or Save).
 */
export const TopBar = ({
  model,
  title,
  status,
  saveState,
  presence,
  locale,
  preview,
  onSave,
  saving,
  blocked,
  settingsOpen,
  onToggleSettings,
  primary,
}: TopBarProps) => {
  const { t } = useTranslation();
  return (
    <div
      data-slot="entry-top-bar"
      className="sticky top-12 z-20 -mx-4 -mt-7 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-background/95 px-4 py-2.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-8 sm:px-8 lg:top-0"
    >
      <div className="flex min-w-0 flex-1 items-center gap-x-3 gap-y-1 text-meta text-muted-foreground max-sm:flex-wrap">
        <nav aria-label={t('common.breadcrumb')} className="min-w-0">
          <ol className="flex min-w-0 items-center gap-1.5 font-medium">
            <li className="shrink-0">
              {model.kind === 'collection' ? (
                <Link
                  to="/content/$modelKey"
                  params={{ modelKey: model.apiKey }}
                  className="rounded-sm outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {model.label}
                </Link>
              ) : (
                model.label
              )}
            </li>
            <li aria-hidden="true" className="text-muted-foreground/70">
              /
            </li>
            <li aria-current="page" className="min-w-0 truncate font-semibold text-foreground">
              {title}
            </li>
          </ol>
        </nav>
        {status ? <EntryStatusChip status={status} size="sm" /> : null}
        <div className="shrink-0 whitespace-nowrap">{saveState}</div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {presence}
        {locale}
        {onSave ? (
          <Button type="button" variant="ghost" size="sm" disabled={saving || blocked} onClick={onSave}>
            {spinnerOr(saving, <Save aria-hidden="true" />)}
            {t('content.form.save')}
          </Button>
        ) : null}
        {preview}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={settingsOpen}
              aria-controls="entry-settings"
              onClick={onToggleSettings}
            >
              <PanelRight aria-hidden="true" />
              <span className="max-sm:sr-only">{t('entry.settings.open')}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {t('entry.shortcutHint', { action: t('entry.settings.open'), keys: '⌘/' })}
          </TooltipContent>
        </Tooltip>
        {primary.kind === 'publish' ? (
          primary.upToDate ? (
            <Button type="button" size="sm" disabled>
              <Check aria-hidden="true" />
              {t('content.actions.published')}
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={saving || blocked} onClick={primary.onClick}>
              <Send aria-hidden="true" />
              {t('content.actions.publish')}
            </Button>
          )
        ) : primary.kind === 'none' ? null : (
          <Button type="button" size="sm" disabled={primary.pending || blocked} onClick={primary.onClick}>
            {spinnerOr(primary.pending, <Save aria-hidden="true" />)}
            {primary.label}
          </Button>
        )}
      </div>
    </div>
  );
};
