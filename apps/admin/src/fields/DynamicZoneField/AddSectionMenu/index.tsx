import type { ComponentDefinition } from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AddItemButton } from '../../AddItemButton';
import { useDeferredMenuAction } from '../../hooks/useDeferredMenuAction';

type AddSectionMenuProps = {
  allowed: readonly ComponentDefinition[];
  onAdd: (component: ComponentDefinition) => void;
};

/** "Add section": a menu of the zone's allowed components. Adds after the menu closes, so focus can move. */
export const AddSectionMenu = ({ allowed, onAdd }: AddSectionMenuProps) => {
  const { t } = useTranslation();
  const menu = useDeferredMenuAction();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <AddItemButton label={t('content.items.addSection')} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" onCloseAutoFocus={menu.onCloseAutoFocus}>
        {allowed.map((component) => (
          <DropdownMenuItem key={component.id} onSelect={() => menu.defer(() => onAdd(component))}>
            {component.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
