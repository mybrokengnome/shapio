import type { DocumentLayout } from '@shapio/schema';
import { History } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { DrawerSection } from '../DrawerSection';
import { PropertyRow } from '../PropertyRow';

/** Where the drawer opens: its top, the properties (one of them expanded) or the cover. */
export type DrawerFocus = { section: 'status' | 'properties' | 'cover'; property?: string };

type SettingsDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  focus: DrawerFocus;
  layout: DocumentLayout;
  /** Properties whose rows are expanded (by API key). */
  expanded: ReadonlySet<string>;
  onToggleProperty: (apiKey: string) => void;
  status: ReactNode;
  cover: ReactNode;
  onOpenHistory?: () => void;
  danger: ReactNode;
};

const focusTargetOf = (focus: DrawerFocus) =>
  document.querySelector<HTMLElement>(
    focus.property
      ? `[data-property-row="${CSS.escape(focus.property)}"] > button`
      : `[data-drawer-section="entry-settings-${focus.section}"] :is(button, input, [href])`,
  );

/**
 * The entry's settings beside the document (360px on the right, a bottom sheet on phones): status and
 * locales, every property as a compact row, the cover's alt text and focal point, history, and the danger
 * zone. Non-modal: the document stays editable while it is open; Escape or ⌘/ closes it.
 */
export const SettingsDrawer = ({
  open,
  onOpenChange,
  focus,
  layout,
  expanded,
  onToggleProperty,
  status,
  cover,
  onOpenHistory,
  danger,
}: SettingsDrawerProps) => {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  useEffect(() => {
    if (open) {
      document
        .querySelector(`[data-drawer-section="entry-settings-${focus.section}"]`)
        ?.scrollIntoView({ block: 'start' });
    }
  }, [open, focus]);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        id="entry-settings"
        nonModal
        side={mobile ? 'bottom' : 'right'}
        size="xs"
        // Focus goes to what the drawer was opened for: a property's row, a section, or its first control.
        onOpenAutoFocus={(event) => {
          const target = focusTargetOf(focus);
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <SheetHeader className="pb-2">
          <SheetTitle className="text-base">{t('entry.settings.title')}</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-7">
          {status}
          {layout.properties.length > 0 ? (
            <DrawerSection id="entry-settings-properties" title={t('entry.properties.title')}>
              {layout.propertyGroups.map((group) => (
                <div key={group.id} className="space-y-1">
                  {group.label ? <h4 className="pt-2 text-sm font-semibold">{group.label}</h4> : null}
                  {group.fields.map((field) => (
                    <PropertyRow
                      key={field.id}
                      field={field}
                      expanded={expanded.has(field.apiKey)}
                      onToggle={() => onToggleProperty(field.apiKey)}
                    />
                  ))}
                </div>
              ))}
            </DrawerSection>
          ) : null}
          {cover}
          {onOpenHistory ? (
            <DrawerSection id="entry-settings-history" title={t('content.history.title')}>
              <Button type="button" variant="outline" size="sm" onClick={onOpenHistory}>
                <History aria-hidden="true" />
                {t('entry.settings.allVersions')}
              </Button>
            </DrawerSection>
          ) : null}
          {danger}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
};
