import { publicShapioUrl } from '#lib/server/config.ts';
import type { PageServerLoad } from './$types';

/** The preview page is prerendered like the rest; the draft itself is read in the browser (see +page.svelte). */
export const load: PageServerLoad = () => ({ shapioUrl: publicShapioUrl() });
