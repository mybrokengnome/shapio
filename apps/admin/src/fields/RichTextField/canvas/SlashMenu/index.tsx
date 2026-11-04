import type { Editor } from '@tiptap/core';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/helpers/cn';
import {
  filterAssistOptions,
  filterBlockOptions,
  type AssistOption,
  type BlockOption,
  type MenuChoice,
} from '../blocks';
import { closeSlashMenu, type SlashBridge, type SlashState } from '../slashCommand';

type SlashMenuProps = {
  editor: Editor;
  bridge: SlashBridge;
  onChoose: (choice: MenuChoice, state: SlashState) => void;
  /** Offer the Assist group ("Write…", "Continue writing") after the blocks (only while assist is on). */
  assist: boolean;
};

/** One row of the menu: a block type or an assist, with what it shows and what choosing it does. */
type SlashOption = { id: string; icon: BlockOption['icon']; label: string; choice: MenuChoice };

const MOVES: Readonly<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };

/**
 * The `/` menu: a listbox under the cursor, filtered by what follows the slash. Focus stays in the text
 * (the editor's keys drive it: ↑ ↓ to move, Enter or Tab to choose, Esc to close).
 */
export const SlashMenu = ({ editor, bridge, onChoose, assist }: SlashMenuProps) => {
  const { t } = useTranslation();
  const listId = useId();
  const [state, setState] = useState<SlashState | null>(null);
  const [active, setActive] = useState(0);
  const options: SlashOption[] = state
    ? [
        ...filterBlockOptions(state.query, (option) => t(option.labelKey)).map((option) => ({
          id: option.type,
          icon: option.icon,
          label: t(option.labelKey),
          choice: { kind: 'block' as const, type: option.type },
        })),
        ...(assist ? filterAssistOptions(state.query, (option: AssistOption) => t(option.labelKey)) : []).map(
          (option) => ({
            id: `assist-${option.write}`,
            icon: option.icon,
            label: t(option.labelKey),
            choice: { kind: 'assist' as const, write: option.write },
          }),
        ),
      ]
    : [];
  const current = options[Math.min(active, options.length - 1)];
  const choose = (option: SlashOption | undefined) => {
    if (option && state) {
      onChoose(option.choice, state);
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
              key={option.id}
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
              {option.label}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
};
