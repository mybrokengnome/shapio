import { useTranslation } from 'react-i18next';
import { DropdownMenuGroup, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { InsertMenuItem } from '../../../InsertMenuItem';
import { BLOCK_OPTIONS, type BlockGroup, type BlockType } from '../blocks';

type BlockMenuItemsProps = {
  onSelect: (type: BlockType) => void;
  /** Images need the media picker; without it the image entry is left out. */
  canInsertImages?: boolean;
  /** Prefix for the group headings when several fields' blocks share one menu ("Body"). */
  heading?: string;
};

const GROUP_KEYS = {
  write: 'entry.blocks.groupWrite',
  media: 'entry.blocks.groupMedia',
} as const satisfies Record<BlockGroup, string>;

/** The rich-text block types as `+` menu entries, grouped Write / Media (inside a `DropdownMenuContent`). */
export const BlockMenuItems = ({ onSelect, canInsertImages = true, heading }: BlockMenuItemsProps) => {
  const { t } = useTranslation();
  return (['write', 'media'] as const).map((group) => (
    <DropdownMenuGroup key={group}>
      <DropdownMenuLabel className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {heading
          ? t('entry.blocks.groupIn', { group: t(GROUP_KEYS[group]), field: heading })
          : t(GROUP_KEYS[group])}
      </DropdownMenuLabel>
      {BLOCK_OPTIONS.filter((option) => option.group === group)
        .filter((option) => canInsertImages || option.type !== 'image')
        .map((option) => (
          <InsertMenuItem
            key={option.type}
            icon={option.icon}
            label={t(option.labelKey)}
            hint={option.type === 'image' ? t('entry.blocks.imageHint') : undefined}
            onSelect={() => onSelect(option.type)}
          />
        ))}
    </DropdownMenuGroup>
  ));
};
