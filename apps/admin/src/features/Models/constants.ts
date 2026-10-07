import type { DefinitionCategory } from '@shapio/client';
import type { DataType, DefinitionKind } from '@shapio/schema';
import {
  AlignLeft,
  Binary,
  Blocks,
  Braces,
  Calendar,
  CalendarClock,
  Clock,
  Code,
  Component,
  FileText,
  Fingerprint,
  Hash,
  Image,
  Layers,
  LayoutList,
  Link,
  Link2,
  List,
  Mail,
  Percent,
  Sigma,
  TextCursorInput,
  ToggleLeft,
  Type,
  type LucideIcon,
} from 'lucide-react';

/** The tabs the old Models screen had (`/models?tab=` still redirects by them). */
export const MODEL_TABS = ['collections', 'singletons', 'components'] as const;
export type ModelTab = (typeof MODEL_TABS)[number];

/** The kinds `/models/new?kind=` accepts (the search schema can't import @shapio/schema: it loads lazily). */
export const NEW_DEFINITION_KINDS = [
  'collection',
  'singleton',
  'component',
] as const satisfies readonly DefinitionKind[];

export const categoryOfKind = (kind: DefinitionKind): DefinitionCategory =>
  kind === 'component' ? 'component' : 'model';

export const KIND_LABEL_KEYS = {
  collection: 'models.kinds.collection',
  singleton: 'models.kinds.singleton',
  component: 'models.kinds.component',
} as const satisfies Record<DefinitionKind, string>;

export const KIND_DESCRIPTION_KEYS = {
  collection: 'models.kinds.collectionDescription',
  singleton: 'models.kinds.singletonDescription',
  component: 'models.kinds.componentDescription',
} as const satisfies Record<DefinitionKind, string>;

export const KIND_ICONS: Readonly<Record<DefinitionKind, LucideIcon>> = {
  collection: LayoutList,
  singleton: FileText,
  component: Component,
};

export const DATA_TYPE_ICONS: Readonly<Record<DataType, LucideIcon>> = {
  string: Type,
  text: AlignLeft,
  code: Code,
  richtext: TextCursorInput,
  number: Sigma,
  integer: Hash,
  decimal: Percent,
  biginteger: Binary,
  boolean: ToggleLeft,
  date: Calendar,
  datetime: CalendarClock,
  time: Clock,
  enum: List,
  json: Braces,
  slug: Link2,
  email: Mail,
  url: Link,
  uid: Fingerprint,
  media: Image,
  relation: Layers,
  component: Component,
  dynamiczone: Blocks,
};

/** Data types offered for component definitions exclude nothing; models and components share the list. */
export const DATA_TYPE_GROUPS: readonly {
  key: 'text' | 'number' | 'choice' | 'time' | 'structure';
  types: readonly DataType[];
}[] = [
  { key: 'text', types: ['string', 'text', 'richtext', 'code', 'slug', 'email', 'url', 'uid'] },
  { key: 'number', types: ['number', 'integer', 'decimal', 'biginteger'] },
  { key: 'choice', types: ['boolean', 'enum', 'json'] },
  { key: 'time', types: ['date', 'datetime', 'time'] },
  { key: 'structure', types: ['media', 'relation', 'component', 'dynamiczone'] },
];

/** How a plan change is applied (see helpers/planBuckets), as shown on its chip. */
export const PLAN_BUCKET_LABEL_KEYS = {
  breaking: 'models.plan.buckets.breaking',
  prerequisites: 'models.plan.buckets.prerequisites',
  live: 'models.plan.buckets.live',
  metadata: 'models.plan.buckets.metadata',
} as const;
