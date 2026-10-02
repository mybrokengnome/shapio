import type { ComponentDefinition } from '@shapio/schema';
import { Boxes, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDeferredMenuAction } from '../hooks/useDeferredMenuAction';
import { InsertMenuItem } from '../InsertMenuItem';

type ItemInserterProps = {
  /** The components that can be stored here (a zone's allowed ones, or the repeatable's one). */
  components: readonly ComponentDefinition[];
  /** Where the new block goes, for its name ("Add a block before item 2"). */
  position: number;
  onInsert: (component: ComponentDefinition) => void;
};

/**
 * An insertion point between two component blocks of the canvas: a hairline with `+` that shows on hover
 * or keyboard focus and offers only what this list can hold.
 */
export const ItemInserter = ({ components, position, onInsert }: ItemInserterProps) => {
  const { t } = useTranslation();
  const menu = useDeferredMenuAction();
  return (
    <li className="group/inserter relative flex h-4 items-center" data-item-inserter>
      <span
        aria-hidden="true"
        className="h-px flex-1 bg-border opacity-0 transition-opacity group-focus-within/inserter:opacity-100 group-hover/inserter:opacity-100"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            className="absolute left-1/2 -translate-x-1/2 rounded-full bg-background opacity-0 transition-opacity group-hover/inserter:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            aria-label={t('entry.blocks.insertAt', { position })}
          >
            <Plus aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-72" onCloseAutoFocus={menu.onCloseAutoFocus}>
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {t('entry.blocks.groupComponents')}
            </DropdownMenuLabel>
            {components.map((component) => (
              <InsertMenuItem
                key={component.id}
                icon={Boxes}
                label={component.label}
                onSelect={() => menu.defer(() => onInsert(component))}
              />
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
};
