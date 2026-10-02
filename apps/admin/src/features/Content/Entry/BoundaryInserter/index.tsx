import { Boxes, ImagePlus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDeferredMenuAction } from '@/fields/hooks/useDeferredMenuAction';
import { InsertMenuItem } from '@/fields/InsertMenuItem';
import { BlockMenuItems } from '@/fields/RichTextField/canvas/BlockMenuItems';
import { cn } from '@/helpers/cn';
import type { Edge, FieldInsertions, useCanvasInsertions } from '../hooks/useCanvasInsertions';

type Target = { insertions: FieldInsertions; edge: Edge };

type BoundaryInserterProps = {
  /** The end of the field above and the start of the field below (either may be missing). */
  targets: readonly Target[];
  actions: ReturnType<typeof useCanvasInsertions>;
  /** The last one: always visible ("Add a block, or just keep writing"), not only on hover. */
  final: boolean;
};

const GroupLabel = ({ children }: { children: string }) => (
  <DropdownMenuLabel className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
    {children}
  </DropdownMenuLabel>
);

/**
 * The `+` between two canvas fields (and after the last): offers exactly what can be stored there, the
 * block types of a rich-text field and the components of a zone or list, labelled by field when both meet.
 */
export const BoundaryInserter = ({ targets, actions, final }: BoundaryInserterProps) => {
  const { t } = useTranslation();
  const menu = useDeferredMenuAction();
  const usable = targets.filter(({ insertions }) => insertions.kind !== 'none');
  if (usable.length === 0) {
    return null;
  }
  const several = usable.length > 1;
  return (
    <div
      className={cn('group/boundary relative flex items-center font-sans', final ? 'pt-2' : 'h-6')}
      data-boundary
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {final ? (
            <Button type="button" variant="ghost" size="sm" className="-ml-2 text-muted-foreground">
              <Plus aria-hidden="true" />
              {t('entry.blocks.addBlock')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              className="relative z-10 rounded-full bg-background opacity-0 transition-opacity group-hover/boundary:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              aria-label={t('entry.blocks.addBetween', {
                fields: usable.map(({ insertions }) => insertions.field.label).join(', '),
              })}
            >
              <Plus aria-hidden="true" />
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-96 w-80 overflow-y-auto"
          onCloseAutoFocus={menu.onCloseAutoFocus}
        >
          {usable.map(({ insertions, edge }, index) => (
            <DropdownMenuGroup key={`${insertions.field.id}-${edge}`}>
              {index > 0 ? <DropdownMenuSeparator /> : null}
              {insertions.kind === 'richText' ? (
                <BlockMenuItems
                  heading={several ? insertions.field.label : undefined}
                  onSelect={(type) => menu.defer(() => actions.insertBlock(insertions.field, type, edge))}
                />
              ) : insertions.kind === 'components' ? (
                <>
                  <GroupLabel>
                    {several
                      ? t('entry.blocks.groupIn', {
                          group: t('entry.blocks.groupComponents'),
                          field: insertions.field.label,
                        })
                      : t('entry.blocks.groupComponents')}
                  </GroupLabel>
                  {insertions.components.map((component) => (
                    <InsertMenuItem
                      key={component.id}
                      icon={Boxes}
                      label={component.label}
                      onSelect={() =>
                        menu.defer(() => actions.insertComponent(insertions.field, component, edge))
                      }
                    />
                  ))}
                </>
              ) : insertions.kind === 'files' ? (
                <>
                  <GroupLabel>{insertions.field.label}</GroupLabel>
                  <InsertMenuItem
                    icon={ImagePlus}
                    label={t('entry.blocks.addFiles', { field: insertions.field.label })}
                    onSelect={() => menu.defer(() => void actions.insertFiles(insertions.field, edge))}
                  />
                </>
              ) : null}
            </DropdownMenuGroup>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {final ? null : (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 h-px bg-border opacity-0 transition-opacity group-hover/boundary:opacity-100"
        />
      )}
    </div>
  );
};
