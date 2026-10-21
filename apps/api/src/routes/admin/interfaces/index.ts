import { createDefinitionRoutes } from '../models/definitionRoutes.js';

/** /api/admin/interfaces: interfaces, contracts of fields that collections and singletons implement. */
export const interfacesRoutes = createDefinitionRoutes('interface');
