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

/** A second line under some entries: what the block needs, or how to work in it. */
const HINT_KEYS: Partial<Record<BlockType, 'entry.blocks.imageHint' | 'content.richText.listJoinHint'>> = {
  image: 'entry.blocks.imageHint',
  bulletList: 'content.richText.listJoinHint',
  orderedList: 'content.richText.listJoinHint',
};

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
        .map((option) => {
          const hintKey = HINT_KEYS[option.type];
          return (
            <InsertMenuItem
              key={option.type}
              icon={option.icon}
              label={t(option.labelKey)}
              hint={hintKey ? t(hintKey) : undefined}
              onSelect={() => onSelect(option.type)}
            />
          );
        })}
    </DropdownMenuGroup>
  ));
};
