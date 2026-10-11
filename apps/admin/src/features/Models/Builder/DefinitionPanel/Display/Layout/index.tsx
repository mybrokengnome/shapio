import {
  ENTRY_LAYOUTS,
  entryLayoutOf,
  type EntryLayout,
  type ModelDefinition,
  type ValidationIssue,
} from '@shapio/schema';
import { useTranslation } from 'react-i18next';
import { SelectControl } from '../../../controls/SelectControl';
import { FormWireframe } from '../FormWireframe';

type LayoutProps = {
  model: ModelDefinition;
  /** Issues under `/display/layout`. */
  issues: readonly ValidationIssue[];
  disabled: boolean;
  onChange: (layout: EntryLayout | undefined) => void;
};

const LAYOUT_LABEL_KEYS = {
  document: 'models.builder.layoutDocument',
  form: 'models.builder.layoutForm',
} as const satisfies Record<EntryLayout, string>;

/** "Layout": whether entries open as a document or a form, with a wireframe of the form when it is one. */
export const Layout = ({ model, issues, disabled, onChange }: LayoutProps) => {
  const { t } = useTranslation();
  const layout = entryLayoutOf(model);
  return (
    <>
      <SelectControl
        id="definition-layout"
        label={t('models.builder.layout')}
        hint={t('models.builder.layoutHint')}
        value={layout}
        options={ENTRY_LAYOUTS.map((value) => ({ value, label: t(LAYOUT_LABEL_KEYS[value]) }))}
        // Document is the default, so it is written as unset and the definition stays minimal.
        onChange={(value) => onChange(value === 'form' ? value : undefined)}
        issues={issues}
        disabled={disabled}
      />
      {layout === 'form' ? <FormWireframe model={model} /> : null}
    </>
  );
};
