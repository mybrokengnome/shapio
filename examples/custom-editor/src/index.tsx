import { defineEditor } from '@shapio/editor-sdk';
import { StarRating } from './StarRating';

/** Installed by copying `dist/star-rating.js` to `extensions/editors/` and listing it in `shapio.config.ts`. */
export const editor = defineEditor({ id: 'acme.starRating', dataTypes: ['integer'], component: StarRating });
