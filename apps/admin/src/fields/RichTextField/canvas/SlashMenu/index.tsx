import type { Editor } from '@tiptap/core';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/helpers/cn';
import { filterBlockOptions, type BlockOption, type BlockType } from '../blocks';
import { closeSlashMenu, type SlashBridge, type SlashState } from '../slashCommand';

type SlashMenuProps = {
  editor: Editor;
  bridge: SlashBridge;
  onChoose: (type: BlockType, state: SlashState) => void;
};

const MOVES: Readonly<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };

/**
 * The `/` menu: a listbox under the cursor, filtered by what follows the slash. Focus stays in the text
 * (the editor's keys drive it: ↑ ↓ to move, Enter or Tab to choose, Esc to close).
 */
export const SlashMenu = ({ editor, bridge, onChoose }: SlashMenuProps) => {
  const { t } = useTranslation();
  const listId = useId();
  const [state, setState] = useState<SlashState | null>(null);
  const [active, setActive] = useState(0);
  const labelOf = (option: BlockOption) => t(option.labelKey);
  const options = state ? filterBlockOptions(state.query, labelOf) : [];
  const current = options[Math.min(active, options.length - 1)];
  const choose = (option: BlockOption | undefined) => {
    if (option && state) {
      onChoose(option.type, state);
    }
  };
  // The plugin calls whatever the bridge holds now: refreshed after every render, so never stale.
  useEffect(() => {
    bridge.onChange.set((next) => {
      setState(next);
      if (next?.query !== state?.query) {
        setActive(0);
      }
    });
    bridge.onKeyDown.set((event) => {
      if (!state || options.length === 0) {
        return false;
      }
      const move = MOVES[event.key];
      if (move !== undefined) {
        setActive((index) => (index + move + options.length) % options.length);
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        choose(current);
        return true;
      }
      return false;
    });
  });
  useEffect(
    () => () => {
      bridge.onChange.reset();
      bridge.onKeyDown.reset();
    },
    [bridge],
  );
  const open = state !== null && options.length > 0;
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          closeSlashMenu(editor.view);
        }
      }}
    >
      <PopoverAnchor
        virtualRef={{ current: { getBoundingClientRect: () => state?.rect() ?? new DOMRect() } }}
      />
      <PopoverContent
        align="start"
        className="w-72 p-1 font-sans"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <ul
          role="listbox"
          id={listId}
          aria-label={t('entry.blocks.menu')}
          className="max-h-80 overflow-y-auto"
        >
          {options.map((option, index) => (
            <li
              key={option.type}
              role="option"
              aria-selected={option === current}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm',
                option === current && 'bg-accent text-accent-foreground',
              )}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(event) => {
                // Keep focus (and the slash range) in the editor.
                event.preventDefault();
                choose(option);
              }}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
                <option.icon aria-hidden="true" />
              </span>
              {labelOf(option)}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
};
