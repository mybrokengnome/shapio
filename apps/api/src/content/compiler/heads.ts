/** Content heads (package E). Expression indexes live on this table only. */
export const CONTENT_HEADS_TABLE = 'entry_heads';
/** Columns of `entry_heads` the index layout depends on. Package E must keep these names. */
export const CONTENT_HEADS_COLUMNS = {
  data: 'data',
  siteId: 'site_id',
  modelId: 'model_id',
  locale: 'locale',
  state: 'state',
} as const;
