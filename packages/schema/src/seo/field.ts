import type { FieldDefinition } from '../types/definitions.js';
import { SEO_COMPONENT_ID } from './ids.js';

/** Whether a field holds the built-in SEO component (by stable ID, whatever its API ID or editor). */
export const isSeoField = (field: FieldDefinition): boolean =>
  field.type === 'component' && field.settings.component === SEO_COMPONENT_ID && !field.settings.repeatable;
