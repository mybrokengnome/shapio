import type { ModelDefinition } from '@shapio/schema';
import type { ReactNode } from 'react';
import { usePlacePermissions } from '../Place/hooks/usePlacePermissions';
import { Tabs } from '../Place/Tabs';

type EntryFrameProps = {
  model: ModelDefinition;
  /** The place's key as it appears in the URL. */
  modelKey: string;
  children: ReactNode;
};

/**
 * One entry of a collection inside its place: for admins who see the place's Structure, the Entries ·
 * Structure · API tabs sit above the entry, as they do above a single type's document. Everyone else gets
 * the entry alone.
 */
export const EntryFrame = ({ model, modelKey, children }: EntryFrameProps) => {
  const { canSeeStructure } = usePlacePermissions(model);
  return canSeeStructure ? (
    <Tabs tab="entries" placeLabel={model.label} modelKey={modelKey} document entryPage>
      {children}
    </Tabs>
  ) : (
    children
  );
};
