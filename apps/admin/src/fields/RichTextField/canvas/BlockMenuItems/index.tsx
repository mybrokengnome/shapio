import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { DropdownMenuGroup, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { InsertMenuItem } from '../../../InsertMenuItem';
import { ASSIST_OPTIONS, BLOCK_OPTIONS, type BlockGroup, type BlockType, type WriteKind } from '../blocks';

type BlockMenuItemsProps = {
  onSelect: (type: BlockType) => void;
  /** Images need the media picker; without it the image entry is left out. */
  canInsertImages?: boolean;
  /** Prefix for the group headings when several fields' blocks share one menu ("Body"). */
  heading?: string;
  /** "Write…" and "Continue writing" (only while assist is on); without it the Assist group is left out. */
  onAssist?: (write: WriteKind) => void;
};

const GROUP_KEYS = {
  write: 'entry.blocks.groupWrite',
  media: 'entry.blocks.groupMedia',
  assist: 'entry.blocks.groupAssist',
} as const satisfies Record<BlockGroup | 'assist', string>;

/** A second line under some entries: what the block needs, or how to work in it. */
const HINT_KEYS: Partial<Record<BlockType, 'entry.blocks.imageHint' | 'content.richText.listJoinHint'>> = {
  image: 'entry.blocks.imageHint',
  bulletList: 'content.richText.listJoinHint',
  orderedList: 'content.richText.listJoinHint',
};

/** A group's heading, prefixed with the field's name when several fields share the menu. */
const groupLabel = (t: TFunction, group: keyof typeof GROUP_KEYS, heading: string | undefined) => (
  <DropdownMenuLabel className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
    {heading
      ? t('entry.blocks.groupIn', { group: t(GROUP_KEYS[group]), field: heading })
      : t(GROUP_KEYS[group])}
  </DropdownMenuLabel>
);

/**
 * The rich-text block types as `+` menu entries, grouped Write / Media, then Assist while it is on (inside a
 * `DropdownMenuContent`).
 */
export const BlockMenuItems = ({
  onSelect,
  canInsertImages = true,
  heading,
  onAssist,
}: BlockMenuItemsProps) => {
  const { t } = useTranslation();
  const blockGroups = (['write', 'media'] as const).map((group) => (
    <DropdownMenuGroup key={group}>
      {groupLabel(t, group, heading)}
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
  return (
    <>
      {blockGroups}
      {onAssist ? (
        <DropdownMenuGroup>
          {groupLabel(t, 'assist', heading)}
          {ASSIST_OPTIONS.map((option) => (
            <InsertMenuItem
              key={option.write}
              icon={option.icon}
              label={t(option.labelKey)}
              onSelect={() => onAssist(option.write)}
            />
          ))}
        </DropdownMenuGroup>
      ) : null}
    </>
  );
};
