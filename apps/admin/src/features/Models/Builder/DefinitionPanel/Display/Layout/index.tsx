import {
  ENTRY_LAYOUTS,
  entryLayoutOf,
  storedEntryLayout,
  type EntryLayout,
  type ModelDefinition,
  type ValidationIssue,
} from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { SelectControl } from '../../../controls/SelectControl';
import { FormWireframe } from '../FormWireframe';

/** What a kind would inherit: its parent's label and effective layout. */
export type InheritedLayout = { parentLabel: string; layout: EntryLayout };

type LayoutProps = {
  /** The draft resolved over its parent: its effective layout picks the wireframe. */
  model: ModelDefinition;
  /** The draft's own `display.layout`; unset inherits the parent's (Document on a model that extends nothing). */
  ownLayout: EntryLayout | undefined;
  /** On a kind: offered first as "Same as <parent> (<layout>)", which clears its own layout. */
  inherited?: InheritedLayout;
  /** Issues under `/display/layout`. */
  issues: readonly ValidationIssue[];
  disabled: boolean;
  onChange: (layout: EntryLayout | undefined) => void;
};

const LAYOUT_LABEL_KEYS = {
  document: 'models.builder.layoutDocument',
  form: 'models.builder.layoutForm',
} as const satisfies Record<EntryLayout, string>;

/**
 * "Layout": whether entries open as a document or a form, with a wireframe of the form when it is one. A kind
 * can also follow its parent's layout (no own value), including the parent's later changes.
 */
export const Layout = ({ model, ownLayout, inherited, issues, disabled, onChange }: LayoutProps) => {
  const { t } = useTranslation();
  const layout = entryLayoutOf(model);
  return (
    <>
      <SelectControl
        id="definition-layout"
        label={t('models.builder.layout')}
        hint={t('models.builder.layoutHint')}
        value={inherited ? ownLayout : layout}
        options={ENTRY_LAYOUTS.map((value) => ({ value, label: t(LAYOUT_LABEL_KEYS[value]) }))}
        unsetLabel={
          inherited
            ? t('models.builder.layoutInherited', {
                parent: inherited.parentLabel,
                layout: t(LAYOUT_LABEL_KEYS[inherited.layout]),
              })
            : undefined
        }
        // Document is the default, so a model that extends nothing leaves it unset; a kind spells it out.
        // The "Same as" option (unset) clears a kind's own layout.
        onChange={(value) => {
          const chosen = ENTRY_LAYOUTS.find((option) => option === value);
          onChange(chosen && storedEntryLayout(model, chosen));
        }}
        issues={issues}
        disabled={disabled}
      />
      {layout === 'form' ? <FormWireframe model={model} /> : null}
    </>
  );
};
