import type { EntryLayout, ModelDefinition } from '@shapio/schema';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/helpers/cn';
import { DrawerSection } from '../DrawerSection';
import { useLayoutSwitch } from '../hooks/useLayoutSwitch';

type LayoutSectionProps = { model: ModelDefinition };

const SECTION_ID = 'entry-settings-layout';
const SWITCH_ID = `${SECTION_ID}-switch`;

const wordClasses = {
  chosen: 'text-foreground',
  other: 'text-muted-foreground hover:text-foreground',
} as const;

/**
 * How the type's entries open, switched from the entry itself (for whoever manages the schema): a switch
 * between the words Document and Form, on for Form. Either word picks its side. The change ships at once,
 * live, and the toast offers Undo.
 */
export const LayoutSection = ({ model }: LayoutSectionProps) => {
  const { t } = useTranslation();
  const { layout, change, pending } = useLayoutSwitch(model);
  const form = layout === 'form';
  // A word is a label of the switch; the chosen side's word does nothing instead of toggling it away.
  const word = (side: EntryLayout, text: string) => (
    <label
      htmlFor={SWITCH_ID}
      onClick={(event: MouseEvent) => {
        if (side === layout) {
          event.preventDefault();
        }
      }}
      className={cn(
        'cursor-pointer text-sm font-medium transition-colors',
        side === layout ? wordClasses.chosen : wordClasses.other,
        pending && 'pointer-events-none opacity-50',
      )}
    >
      {text}
    </label>
  );
  return (
    <DrawerSection id={SECTION_ID} title={t('models.builder.layout')}>
      <div className="flex h-9 items-center gap-3">
        {word('document', t('models.builder.layoutDocument'))}
        <Switch
          id={SWITCH_ID}
          aria-label={t('entry.layout.switchLabel')}
          checked={form}
          disabled={pending}
          onCheckedChange={(checked) => void change(checked ? 'form' : 'document')}
        />
        {word('form', t('models.builder.layoutForm'))}
      </div>
    </DrawerSection>
  );
};
