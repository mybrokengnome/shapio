import { LayoutGrid, List, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useSearchInput } from '@/hooks/useSearchInput';
import { MEDIA_TYPE_FILTERS, type MediaTypeFilter, type MediaView } from '../constants';

type ToolbarProps = {
  query: string | undefined;
  type: MediaTypeFilter | undefined;
  view: MediaView;
  onQueryChange: (query: string | undefined) => void;
  onTypeChange: (type: MediaTypeFilter | undefined) => void;
  onViewChange: (view: MediaView) => void;
};

const ALL_TYPES = 'all';

const TYPE_LABEL_KEYS = {
  image: 'media.types.image',
  video: 'media.types.video',
  audio: 'media.types.audio',
  pdf: 'media.types.pdf',
} as const satisfies Record<MediaTypeFilter, string>;

/** Search, type filter and grid/list switch. */
export const Toolbar = ({ query, type, view, onQueryChange, onTypeChange, onViewChange }: ToolbarProps) => {
  const { t } = useTranslation();
  const { text, setText } = useSearchInput(query, onQueryChange);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-48 flex-1">
        <Search
          aria-hidden="true"
          className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-label={t('media.search')}
          placeholder={t('media.searchPlaceholder')}
          inputSize="sm"
          className="pl-8"
        />
      </div>
      <Select
        value={type ?? ALL_TYPES}
        onValueChange={(value) => onTypeChange(value === ALL_TYPES ? undefined : (value as MediaTypeFilter))}
      >
        <SelectTrigger size="sm" aria-label={t('media.typeFilter')} className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_TYPES}>{t('media.types.all')}</SelectItem>
          {MEDIA_TYPE_FILTERS.map((filter) => (
            <SelectItem key={filter} value={filter}>
              {t(TYPE_LABEL_KEYS[filter])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div
        role="group"
        aria-label={t('media.view')}
        className="flex h-9 items-center gap-0.5 rounded-lg border border-input px-px"
      >
        <Button
          variant={view === 'grid' ? 'secondary' : 'ghost'}
          size="icon-sm"
          aria-pressed={view === 'grid'}
          aria-label={t('media.viewGrid')}
          onClick={() => onViewChange('grid')}
        >
          <LayoutGrid aria-hidden="true" />
        </Button>
        <Button
          variant={view === 'list' ? 'secondary' : 'ghost'}
          size="icon-sm"
          aria-pressed={view === 'list'}
          aria-label={t('media.viewList')}
          onClick={() => onViewChange('list')}
        >
          <List aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
};
