import type { PreviewTarget } from '@shapio/client';
import { ExternalLink, FileText, RotateCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { IconAction } from './IconAction';

type ToolbarProps = {
  headingId: string;
  targets: readonly PreviewTarget[];
  target: PreviewTarget | undefined;
  onChooseTarget: (connectionId: string) => void;
  /** The site's URL for this preview (opened in a new tab without the visual-editing flag). */
  siteUrl: string | undefined;
  onReload: (() => void) | undefined;
  onShowDocument: () => void;
  onClose: () => void;
};

/** The preview pane's header: which site, and reload, open in a new tab, the document (phones), close. */
export const Toolbar = ({
  headingId,
  targets,
  target,
  onChooseTarget,
  siteUrl,
  onReload,
  onShowDocument,
  onClose,
}: ToolbarProps) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <h2 id={headingId} className="text-sm font-semibold max-sm:sr-only">
        {t('content.form.preview')}
      </h2>
      {targets.length > 1 ? (
        <Select value={target?.connectionId ?? ''} onValueChange={onChooseTarget}>
          <SelectTrigger size="sm" aria-label={t('entry.preview.site')} className="max-w-48 min-w-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {targets.map((item) => (
              <SelectItem key={item.connectionId} value={item.connectionId}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <div className="ml-auto flex items-center gap-1">
        {onReload ? (
          <IconAction
            label={t('entry.preview.reload')}
            onClick={onReload}
            icon={<RotateCw aria-hidden="true" />}
          />
        ) : null}
        {siteUrl ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" asChild>
                <a
                  href={siteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                  aria-label={t('entry.preview.openInTab')}
                >
                  <ExternalLink aria-hidden="true" />
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('entry.preview.openInTab')}</TooltipContent>
          </Tooltip>
        ) : null}
        <Button type="button" variant="outline" size="sm" className="lg:hidden" onClick={onShowDocument}>
          <FileText aria-hidden="true" />
          {t('entry.preview.showDocument')}
        </Button>
        <IconAction label={t('entry.preview.close')} onClick={onClose} icon={<X aria-hidden="true" />} />
      </div>
    </div>
  );
};
