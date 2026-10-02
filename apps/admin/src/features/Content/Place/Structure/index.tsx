import type { ModelDefinition } from '@shapio/schema';
import { Builder } from '@/features/Models/Builder';

type StructureProps = { model: ModelDefinition };

/** The place's structure: the model builder (fields, settings, display), applied live. */
export const Structure = ({ model }: StructureProps) => <Builder category="model" id={model.id} />;
