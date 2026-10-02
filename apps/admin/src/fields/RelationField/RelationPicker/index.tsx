import type { ModelDefinition } from '@shapio/schema';
import { Plus } from 'lucide-react';
import { useId, useRef, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useIsMdUp } from '../../hooks/useIsMdUp';
import { Results } from './Results';

type RelationPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The field's button that opens the picker; absent while nothing more can be linked. */
  trigger: ReactElement | null;
  target: ModelDefinition;
  multiple: boolean;
  /** Linked now. */
  selected: readonly string[];
  /** Never offered (the entry being edited, for self-relations). */
  exclude: readonly string[];
  locale: string | null;
  /** No more may be linked (relation `max`). */
  full: boolean;
  canCreate: boolean;
  /** Links an entry: in single mode the picker then closes, in multi mode it stays open for more. */
  onPick: (id: string) => void;
  onUnpick: (id: string) => void;
  /** Runs once the picker has closed (focus is back on the trigger), to open the create sheet. */
  onCreate: () => void;
  /** Where focus goes on close when the trigger is gone (the relation is full). */
  onFocusFallback: () => void;
};

/**
 * Finds and links entries of a relation's target model (DESIGN.md "Dialogs": pickers). From `md` up it is a
 * modal popover anchored to the field; below, the same body in a bottom sheet. In multi mode every pick
 * links at once and the picker stays open; "Create new" closes it before the create sheet opens.
 */
export const RelationPicker = ({
  open,
  onOpenChange,
  trigger,
  target,
  multiple,
  selected,
  exclude,
  locale,
  full,
  canCreate,
  onPick,
  onUnpick,
  onCreate,
  onFocusFallback,
}: RelationPickerProps) => {
  const { t } = useTranslation();
  const isMdUp = useIsMdUp();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const creatingRef = useRef(false);
  const title = t('content.relation.chooseTitle', { model: target.label });

  const pick = (id: string) => {
    onPick(id);
    if (!multiple) {
      onOpenChange(false);
    }
  };
  const startCreate = () => {
    creatingRef.current = true;
    onOpenChange(false);
  };
  /** Runs when the picker has closed: return focus ourselves when handing off or when the trigger is gone. */
  const onCloseAutoFocus = (event: Event) => {
    const creating = creatingRef.current;
    creatingRef.current = false;
    const trigger = triggerRef.current;
    if (!creating && trigger?.isConnected) {
      return;
    }
    event.preventDefault();
    if (trigger?.isConnected) {
      trigger.focus({ preventScroll: true });
    } else {
      onFocusFallback();
    }
    if (creating) {
      onCreate();
    }
  };

  const results = (listClassName?: string) => (
    <Results
      target={target}
      locale={locale}
      multiple={multiple}
      selected={selected}
      exclude={exclude}
      full={full}
      onPick={pick}
      onUnpick={onUnpick}
      className="flex-1"
      listClassName={listClassName}
    />
  );
  const actions =
    canCreate || multiple ? (
      <>
        {canCreate ? (
          <Button type="button" variant="ghost" size="sm" className="mr-auto" onClick={startCreate}>
            <Plus aria-hidden="true" />
            {t('content.relation.createNew', { model: target.label })}
          </Button>
        ) : null}
        {multiple ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('content.relation.done')}
          </Button>
        ) : null}
      </>
    ) : null;

  if (isMdUp) {
    return (
      <Popover open={open} onOpenChange={onOpenChange} modal>
        {trigger ? (
          <PopoverTrigger asChild ref={triggerRef}>
            {trigger}
          </PopoverTrigger>
        ) : null}
        <PopoverContent
          aria-labelledby={titleId}
          align="start"
          collisionPadding={16}
          className="flex max-h-(--radix-popover-content-available-height) w-96 flex-col gap-3 p-3"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <p id={titleId} className="text-sm font-semibold">
            {title}
          </p>
          {results('max-h-72')}
          {actions ? (
            <div className="flex items-center justify-end gap-2 border-t pt-3">{actions}</div>
          ) : null}
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {trigger ? (
        <SheetTrigger asChild ref={triggerRef}>
          {trigger}
        </SheetTrigger>
      ) : null}
      <SheetContent side="bottom" aria-describedby={undefined} onCloseAutoFocus={onCloseAutoFocus}>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <SheetBody className="flex flex-col">{results()}</SheetBody>
        {actions ? <SheetFooter>{actions}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  );
};
