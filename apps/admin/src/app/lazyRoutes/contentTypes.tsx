import { createLazyRoute } from '@tanstack/react-router';
import { Components } from '@/features/Components';
import { Builder as ComponentBuilder } from '@/features/Components/Builder';
import { New as NewComponent } from '@/features/Components/New';
import { New as NewContentType } from '@/features/Content/New';

/** Creating content types and components, and Develop → Components (with @shapio/schema's validators). */
export const contentTypesLazyRoutes = {
  newContentType: createLazyRoute('/app/content/new')({ component: NewContentType }),
  components: createLazyRoute('/app/develop/components')({ component: Components }),
  newComponent: createLazyRoute('/app/develop/components/new')({ component: NewComponent }),
  component: createLazyRoute('/app/develop/components/$componentId')({ component: ComponentBuilder }),
};
