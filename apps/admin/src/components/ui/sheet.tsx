'use client';

import { cva } from 'class-variance-authority';
import { XIcon } from 'lucide-react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/helpers/cn';
import { useReturnFocus } from '@/hooks/useReturnFocus';

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({ ...props }: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({ ...props }: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-overlay/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Shapio: side sheets are full width on phones and `xs` 360px, `sm` 400px, `md` 560px or `lg` 720px from
 * the sm breakpoint (DESIGN.md "Dialogs"). Top and bottom sheets span the viewport and ignore `size`.
 */
const sheetContentVariants = cva(
  'fixed z-50 flex flex-col gap-0 bg-card shadow-lg transition ease-in-out data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:animate-in data-[state=open]:duration-500',
  {
    variants: {
      side: {
        right:
          'inset-y-0 right-0 h-full w-full border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
        left: 'inset-y-0 left-0 h-full w-full border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left',
        top: 'inset-x-0 top-0 h-auto border-b data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top',
        bottom:
          'inset-x-0 bottom-0 h-auto max-h-[85dvh] rounded-t-xl border-t data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
      },
      size: { xs: '', sm: '', md: '', lg: '' },
    },
    compoundVariants: [
      { side: ['left', 'right'], size: 'xs', className: 'sm:max-w-90' },
      { side: ['left', 'right'], size: 'sm', className: 'sm:max-w-100' },
      { side: ['left', 'right'], size: 'md', className: 'sm:max-w-140' },
      { side: ['left', 'right'], size: 'lg', className: 'sm:max-w-180' },
    ],
    defaultVariants: { side: 'right', size: 'sm' },
  },
);

type SheetSide = 'top' | 'right' | 'bottom' | 'left';
type SheetSize = 'xs' | 'sm' | 'md' | 'lg';

function SheetContent({
  className,
  children,
  side = 'right',
  size = 'sm',
  showCloseButton = true,
  nonModal = false,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: SheetSide;
  /** Width of a left or right sheet from the sm breakpoint: xs 360px, sm 400px (default), md 560px, lg 720px. */
  size?: SheetSize;
  showCloseButton?: boolean;
  /**
   * A panel beside the page instead of over it (the entry document's settings drawer): no backdrop, the
   * page stays interactive, clicking the page doesn't close it; Escape and the close button do. Pair it
   * with `<Sheet modal={false}>`. Only for panels the person works next to; everything else stays modal.
   */
  nonModal?: boolean;
}) {
  const returnFocus = useReturnFocus(onOpenAutoFocus, onCloseAutoFocus);
  const { t } = useTranslation();
  return (
    <SheetPortal>
      {nonModal ? null : <SheetOverlay />}
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-size={size}
        data-non-modal={nonModal || undefined}
        className={cn(sheetContentVariants({ side, size }), nonModal && 'z-30 shadow-none', className)}
        onInteractOutside={(event) => {
          if (nonModal) {
            event.preventDefault();
          }
          onInteractOutside?.(event);
        }}
        {...props}
        {...returnFocus}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close asChild>
            <Button variant="ghost" size="icon-sm" className="absolute top-4 right-4 text-muted-foreground">
              <XIcon aria-hidden="true" />
              <span className="sr-only">{t('common.close')}</span>
            </Button>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex flex-col gap-1.5 px-6 pt-6 pb-4', className)}
      {...props}
    />
  );
}

/** Shapio: the scrolling middle of a sheet, between a fixed header and footer. */
function SheetBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-body"
      className={cn('min-h-0 flex-1 overflow-y-auto px-6 pb-6', className)}
      {...props}
    />
  );
}

/** Shapio: a bordered action row on a muted band, Cancel then the primary action on the right. */
function SheetFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        'mt-auto flex flex-wrap items-center justify-end gap-2 border-t bg-muted/40 px-6 py-4',
        className,
      )}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-lg leading-tight font-semibold tracking-tight text-foreground', className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
