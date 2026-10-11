import { isCanvasEligible, type DocumentLayout } from '@shapio/schema';
import { Canvas } from '../Canvas';
import { Cover } from '../Cover';
import { PropertiesStrip } from '../PropertiesStrip';
import { PropertyGrid } from '../PropertyGrid';
import type { DrawerFocus } from '../SettingsDrawer';
import { Title } from '../Title';

type DocumentBodyProps = {
  layout: DocumentLayout;
  heading: string;
  /** Opens the settings drawer at a section (the cover's details, every property). */
  onOpenSettings: (focus: DrawerFocus) => void;
};

/**
 * A document-layout entry's page: the cover, the title typed into the page, a strip of properties and the
 * canvas of blocks. A model without block fields shows its properties as a grid under the title and any
 * field placed in the document, and no strip.
 */
export const DocumentBody = ({ layout, heading, onOpenSettings }: DocumentBodyProps) => {
  // Rich text, zones, lists or galleries: the page is a document with a strip; otherwise the grid stays.
  const hasBlocks = layout.canvas.some(isCanvasEligible);
  return (
    <>
      {layout.cover ? (
        <Cover field={layout.cover} onEditDetails={() => onOpenSettings({ section: 'cover' })} />
      ) : null}
      <Title field={layout.titleInline ? layout.title : undefined} heading={heading} />
      {hasBlocks ? (
        <PropertiesStrip layout={layout} onMore={() => onOpenSettings({ section: 'properties' })} />
      ) : null}
      {layout.canvas.length > 0 ? <Canvas fields={layout.canvas} /> : null}
      {/* Without blocks the document is a form: the properties stay on the page, under its fields. */}
      {hasBlocks || layout.properties.length === 0 ? null : <PropertyGrid groups={layout.propertyGroups} />}
    </>
  );
};
