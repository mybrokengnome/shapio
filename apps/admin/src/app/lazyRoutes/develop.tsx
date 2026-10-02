import { createLazyRoute } from '@tanstack/react-router';
import { ApiExplorer } from '@/features/Develop/ApiExplorer';
import { Changes } from '@/features/Develop/Changes';
import { ChangeSet } from '@/features/Develop/ChangeSet';
import { Live } from '@/features/Develop/Live';
import { Schema } from '@/features/Develop/Schema';
import { Snapshots } from '@/features/Develop/Snapshots';
import { Detail as SnapshotDetail } from '@/features/Develop/Snapshots/Detail';

/** The developer pages (plan developer-face §2), loaded together on the first visit to one of them. */
export const developLazyRoutes = {
  changes: createLazyRoute('/app/changes')({ component: Changes }),
  changeSet: createLazyRoute('/app/changes/$changeSetId')({ component: ChangeSet }),
  snapshots: createLazyRoute('/app/snapshots')({ component: Snapshots }),
  snapshot: createLazyRoute('/app/snapshots/$seq')({ component: SnapshotDetail }),
  live: createLazyRoute('/app/live')({ component: Live }),
  schema: createLazyRoute('/app/schema')({ component: Schema }),
  apiExplorer: createLazyRoute('/app/api-explorer')({ component: ApiExplorer }),
};
