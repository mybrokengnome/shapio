import { createLazyRoute } from '@tanstack/react-router';
import { Components } from '@/features/Components';
import { Builder as ComponentBuilder } from '@/features/Components/Builder';
import { New as NewComponent } from '@/features/Components/New';
import { New as NewContentType } from '@/features/Content/New';
import { Interfaces } from '@/features/Interfaces';
import { Builder as InterfaceBuilder } from '@/features/Interfaces/Builder';
import { New as NewInterface } from '@/features/Interfaces/New';

/**
 * Creating content types and components, and Develop → Components and Interfaces (with @shapio/schema's
 * validators).
 */
export const contentTypesLazyRoutes = {
  newContentType: createLazyRoute('/app/content/new')({ component: NewContentType }),
  components: createLazyRoute('/app/develop/components')({ component: Components }),
  newComponent: createLazyRoute('/app/develop/components/new')({ component: NewComponent }),
  component: createLazyRoute('/app/develop/components/$componentId')({ component: ComponentBuilder }),
  interfaces: createLazyRoute('/app/develop/interfaces')({ component: Interfaces }),
  newInterface: createLazyRoute('/app/develop/interfaces/new')({ component: NewInterface }),
  interface: createLazyRoute('/app/develop/interfaces/$interfaceId')({ component: InterfaceBuilder }),
};
